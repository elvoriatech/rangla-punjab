import { BRAND } from "../brand";
import { siteUrl } from "../site-url";
import type Redis from "ioredis";
import { asTenant } from "../tenant";
import { logger } from "../logger";
import type { PlanCode } from "../plans";
import { sendEmail } from "../email";
import { TrialEndingEmail } from "@/emails/trial-ending-email";
import type { StripeEvent, StripeProvider } from "./provider";
import { markOrderPaid } from "../connect-service";

/**
 * Webhook business logic. Kept out of the route handler so tests can call
 * it directly without an HTTP round-trip. All DB writes happen through
 * `asTenant(tenantId, …)` — the tenant is read from the Stripe object's
 * `metadata.tenantId`, which we set at checkout creation (P1-19e).
 *
 * Idempotency: every event id we've ever processed is in a Redis SET with
 * a 7-day TTL (Stripe's max retry window). We `SET NX` before any
 * downstream work, so if two Stripe retries land at once, only one wins.
 * Downstream writes are `upsert` shaped anyway, so a double-processing
 * would still converge on the same row state.
 */

const IDEMP_KEY = "stripe:events:seen";
const IDEMP_TTL_SEC = 60 * 60 * 24 * 7;

export type WebhookOutcome =
  { status: 200; kind: "processed" | "replayed" | "ignored" } | { status: 400; kind: "invalid" };

interface Deps {
  provider: StripeProvider;
  redis: Redis;
}

interface HasMetadata {
  metadata?: Record<string, string | null | undefined>;
}

interface CheckoutSessionShape extends HasMetadata {
  customer?: string | null;
  subscription?: string | null;
  client_reference_id?: string | null;
}

interface SubscriptionShape extends HasMetadata {
  id?: string;
  customer?: string | null;
  status?: string;
  current_period_end?: number | null;
  trial_end?: number | null;
  cancel_at?: number | null;
  items?: { data: { price: { id: string }; current_period_end?: number }[] };
}

interface InvoiceShape extends HasMetadata {
  subscription?: string | null;
  subscription_details?: HasMetadata | null;
}

export async function handleStripeEvent(event: StripeEvent, deps: Deps): Promise<WebhookOutcome> {
  const key = `${IDEMP_KEY}:${event.id}`;
  // `SET NX EX` — succeeds only if the event is new. Duplicates return
  // `null`, in which case we short-circuit with 200 (Stripe stops
  // retrying on any 2xx).
  const claim = await deps.redis.set(key, "1", "EX", IDEMP_TTL_SEC, "NX");
  if (claim === null) {
    logger.info("stripe.webhook.replay", { eventId: event.id, type: event.type });
    return { status: 200, kind: "replayed" };
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event, deps);
      return { status: 200, kind: "processed" };
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event);
      return { status: 200, kind: "processed" };
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event);
      return { status: 200, kind: "processed" };
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event);
      return { status: 200, kind: "processed" };
    case "invoice.payment_succeeded":
      await handleInvoicePaymentSucceeded(event);
      return { status: 200, kind: "processed" };
    case "customer.subscription.trial_will_end":
      await handleTrialWillEnd(event);
      return { status: 200, kind: "processed" };
    case "account.updated":
      await handleAccountUpdated(event);
      return { status: 200, kind: "processed" };
    default:
      logger.info("stripe.webhook.ignored", { eventId: event.id, type: event.type });
      return { status: 200, kind: "ignored" };
  }
}

/** Read `tenantId` from either the invoice object itself or its nested
 *  `subscription_details.metadata` — Stripe puts subscription metadata
 *  there on invoice-flavoured events. */
function tenantIdFromInvoice(invoice: InvoiceShape): string | undefined {
  return (
    invoice.metadata?.tenantId ?? invoice.subscription_details?.metadata?.tenantId ?? undefined
  );
}

async function handleCheckoutCompleted(event: StripeEvent, deps: Deps): Promise<void> {
  const session = event.data.object as CheckoutSessionShape;

  // Guest ORDER payment (mode=payment, created on the restaurant's
  // connected account — arrives via the Connect webhook). Routed by the
  // orderId metadata stamped in createOrderCheckout; settlement is
  // idempotent, so Stripe retries converge.
  const orderId = session.metadata?.orderId;
  if (orderId) {
    const orderTenantId = session.metadata?.tenantId;
    if (!orderTenantId) {
      logger.warn("stripe.order.missing_tenant", { eventId: event.id, orderId });
      return;
    }
    const settled = await markOrderPaid(orderTenantId, orderId);
    logger.info("stripe.order.paid", { eventId: event.id, orderId, settled });
    return;
  }

  // SUBSCRIPTION checkout (platform account).
  const tenantId = session.metadata?.tenantId;
  if (!tenantId || !session.customer || !session.subscription) {
    logger.warn("stripe.checkout.missing_context", {
      eventId: event.id,
      hasTenant: Boolean(tenantId),
      hasCustomer: Boolean(session.customer),
      hasSub: Boolean(session.subscription),
    });
    return;
  }

  const sub = await deps.provider.retrieveSubscription(session.subscription);
  if (!sub) {
    logger.warn("stripe.checkout.retrieve_failed", {
      eventId: event.id,
      subscriptionId: session.subscription,
    });
    return;
  }

  const planCode = normalisePlanCode(session.metadata?.planCode);

  // Prisma's `upsert` compiles to `INSERT ... ON CONFLICT (tenant_id)`, but
  // the DB has only a *partial* unique on `tenant_id WHERE deleted_at IS
  // NULL` (P1-19a). Postgres refuses to use that as an ON CONFLICT target
  // through the client. Find-then-write is uglier but correct, and the
  // upsert semantic still holds: the partial unique keeps concurrent
  // creates safe.
  await asTenant(tenantId, async (tx) => {
    const existing = await tx.subscription.findFirst({
      where: { tenantId, deletedAt: null },
      select: { id: true },
    });
    const fields = {
      stripeCustomerId: session.customer ?? null,
      stripeSubscriptionId: sub.id,
      planCode,
      status: mapStatus(sub.status),
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
      trialEnd: sub.trialEnd ?? null,
    };
    if (existing) {
      await tx.subscription.update({
        where: { id: existing.id },
        data: { ...fields, deletedAt: null },
      });
    } else {
      await tx.subscription.create({ data: { tenantId, ...fields } });
    }
  });
}

async function handleSubscriptionUpdated(event: StripeEvent): Promise<void> {
  const subObj = event.data.object as SubscriptionShape;
  const tenantId = subObj.metadata?.tenantId;
  if (!tenantId || !subObj.id) {
    logger.warn("stripe.sub.updated.missing_context", { eventId: event.id });
    return;
  }
  await asTenant(tenantId, (tx) =>
    tx.subscription.updateMany({
      where: { tenantId, stripeSubscriptionId: subObj.id },
      data: {
        status: mapStatus(subObj.status),
        // API ≥2025 (Basil) moved current_period_end onto subscription
        // items — read both homes.
        currentPeriodEnd: (() => {
          const end = subObj.current_period_end ?? subObj.items?.data[0]?.current_period_end;
          return end ? new Date(end * 1000) : null;
        })(),
        trialEnd: subObj.trial_end ? new Date(subObj.trial_end * 1000) : null,
        cancelAt: subObj.cancel_at ? new Date(subObj.cancel_at * 1000) : null,
      },
    }),
  );
}

async function handleSubscriptionDeleted(event: StripeEvent): Promise<void> {
  const subObj = event.data.object as SubscriptionShape;
  const tenantId = subObj.metadata?.tenantId;
  if (!tenantId || !subObj.id) {
    logger.warn("stripe.sub.deleted.missing_context", { eventId: event.id });
    return;
  }
  const cancelAt = subObj.cancel_at ? new Date(subObj.cancel_at * 1000) : new Date();
  await asTenant(tenantId, (tx) =>
    tx.subscription.updateMany({
      where: { tenantId, stripeSubscriptionId: subObj.id },
      data: { status: "canceled", cancelAt },
    }),
  );
}

async function handleInvoicePaymentFailed(event: StripeEvent): Promise<void> {
  const invoice = event.data.object as InvoiceShape;
  const tenantId = tenantIdFromInvoice(invoice);
  const subId = invoice.subscription ?? undefined;
  if (!tenantId || !subId) {
    logger.warn("stripe.invoice.failed.missing_context", { eventId: event.id });
    return;
  }
  // Only nudge live states to `past_due` — a canceled or unpaid sub
  // stays where it is (a failed retry on a canceled sub is noise).
  await asTenant(tenantId, (tx) =>
    tx.subscription.updateMany({
      where: { tenantId, stripeSubscriptionId: subId, status: { in: ["active", "trialing"] } },
      data: { status: "past_due" },
    }),
  );
}

async function handleInvoicePaymentSucceeded(event: StripeEvent): Promise<void> {
  const invoice = event.data.object as InvoiceShape;
  const tenantId = tenantIdFromInvoice(invoice);
  const subId = invoice.subscription ?? undefined;
  if (!tenantId || !subId) {
    logger.warn("stripe.invoice.succeeded.missing_context", { eventId: event.id });
    return;
  }
  // Only clear the dunning states. A regular renewal (`active` →
  // `active`) is a no-op update; keep it a proper state-machine edge.
  await asTenant(tenantId, (tx) =>
    tx.subscription.updateMany({
      where: {
        tenantId,
        stripeSubscriptionId: subId,
        status: { in: ["past_due", "grace"] },
      },
      data: { status: "active" },
    }),
  );
}

/** Mirror the connected account's charges_enabled onto the tenant so
 *  guest payments switch on the moment Stripe finishes KYC — without
 *  waiting for the owner to bounce back through the dashboard. */
async function handleAccountUpdated(event: StripeEvent): Promise<void> {
  const account = event.data.object as HasMetadata & { id?: string; charges_enabled?: boolean };
  const tenantId = account.metadata?.tenantId;
  if (!tenantId || !account.id) {
    logger.info("stripe.account.ignored", { eventId: event.id, hasTenant: Boolean(tenantId) });
    return;
  }
  await asTenant(tenantId, (tx) =>
    tx.tenant.updateMany({
      where: { id: tenantId, stripeAccountId: account.id },
      data: { stripeChargesEnabled: Boolean(account.charges_enabled) },
    }),
  );
  logger.info("stripe.account.updated", {
    eventId: event.id,
    chargesEnabled: Boolean(account.charges_enabled),
  });
}

async function handleTrialWillEnd(event: StripeEvent): Promise<void> {
  const sub = event.data.object as SubscriptionShape;
  const tenantId = sub.metadata?.tenantId;
  if (!tenantId) {
    logger.warn("stripe.trial.willend.missing_context", { eventId: event.id });
    return;
  }

  // Resolve the owning user + tenant name under RLS. Falls through
  // silently if no owner is on file (a tenant without an owner is a bug
  // elsewhere; don't mask it by throwing here).
  const context = await asTenant(tenantId, async (tx) => {
    const tenant = await tx.tenant.findFirstOrThrow({ select: { name: true } });
    const owner = await tx.membership.findFirst({
      where: { role: "owner" },
      include: { user: { select: { email: true } } },
    });
    return { tenantName: tenant.name, ownerEmail: owner?.user.email ?? null };
  });
  if (!context.ownerEmail) {
    logger.warn("stripe.trial.willend.no_owner", { eventId: event.id, tenantId });
    return;
  }

  const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000).toDateString() : "soon";
  // Portal URL is populated post-P1-19e; use a stable placeholder route
  // until the checkout + portal actions land.
  const portalUrl = `${siteUrl()}/dashboard/billing`;
  await sendEmail({
    to: context.ownerEmail,
    subject: `Your ${BRAND.name} trial for ${context.tenantName} ends soon`,
    react: TrialEndingEmail({
      tenantName: context.tenantName,
      trialEndsAt,
      portalUrl,
    }),
  });
}

// ---------- helpers ----------

const KNOWN_STATUSES = new Set([
  "trialing",
  "active",
  "past_due",
  "grace",
  "canceled",
  "incomplete",
  "unpaid",
]);

/** Coerce Stripe's status string to our Prisma enum. Unknown statuses
 *  fall back to `incomplete` so the row stays sane rather than throwing. */
function mapStatus(
  raw: string | undefined,
): "trialing" | "active" | "past_due" | "grace" | "canceled" | "incomplete" | "unpaid" {
  const v = raw ?? "incomplete";
  return (KNOWN_STATUSES.has(v) ? v : "incomplete") as
    "trialing" | "active" | "past_due" | "grace" | "canceled" | "incomplete" | "unpaid";
}

const KNOWN_PLANS: readonly PlanCode[] = ["support"];

/** Metadata-provided planCode wins; unknown values default to the single
 *  support plan so we never store an out-of-catalogue plan. */
function normalisePlanCode(raw: string | null | undefined): PlanCode {
  return raw && (KNOWN_PLANS as readonly string[]).includes(raw) ? (raw as PlanCode) : "support";
}
