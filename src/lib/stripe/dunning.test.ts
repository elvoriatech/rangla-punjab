import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { redis } from "../redis";
import { env } from "../env";
import { asTenant, asUser } from "../tenant";
import { signupUser } from "../auth-service";
import { FakeStripeProvider } from "./fake-provider";
import type { StripeEvent } from "./provider";
import { handleStripeEvent } from "./webhook-handler";

const SECRET = "whsec_test_p1_19d";

async function newTenantWithSub(status: "active" | "past_due" | "trialing" | "canceled"): Promise<{
  tenantId: string;
  userId: string;
  subId: string;
  email: string;
}> {
  const email = `p1-19d-${randomUUID()}@ex.com`;
  const signup = await signupUser({
    email,
    password: "S3cureP4ssPhrase!",
    tenantName: "Dunning test",
  });
  if (!signup.ok) throw new Error("signup failed");
  const subId = `sub_${randomUUID()}`;
  await asTenant(signup.tenantId, (tx) =>
    tx.subscription.create({
      data: { tenantId: signup.tenantId, stripeSubscriptionId: subId, planCode: "support", status },
    }),
  );
  return { tenantId: signup.tenantId, userId: signup.userId, subId, email };
}

function invoiceEvent(
  type: "invoice.payment_failed" | "invoice.payment_succeeded",
  input: { tenantId: string; subId: string },
): StripeEvent {
  return {
    id: `evt_${randomUUID()}`,
    type,
    data: {
      object: {
        subscription: input.subId,
        subscription_details: { metadata: { tenantId: input.tenantId } },
      },
    },
  };
}

describe("dunning + trial-end webhook events", () => {
  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];
  let provider: FakeStripeProvider;

  beforeEach(() => {
    provider = new FakeStripeProvider(SECRET);
  });

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.subscription.deleteMany({}));
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdTenantIds.length = 0;
    createdUserIds.length = 0;
  });

  // ---------- State-machine table for the two invoice events ----------

  const transitions: {
    from: "active" | "past_due" | "trialing" | "canceled";
    event: "invoice.payment_failed" | "invoice.payment_succeeded";
    to: "active" | "past_due" | "trialing" | "canceled";
  }[] = [
    { from: "active", event: "invoice.payment_failed", to: "past_due" },
    { from: "trialing", event: "invoice.payment_failed", to: "past_due" },
    { from: "past_due", event: "invoice.payment_succeeded", to: "active" },
    { from: "canceled", event: "invoice.payment_failed", to: "canceled" },
    { from: "active", event: "invoice.payment_succeeded", to: "active" },
  ];

  it.each(transitions)("$event on $from → $to", async ({ from, event: type, to }) => {
    const { tenantId, userId, subId } = await newTenantWithSub(from);
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    await handleStripeEvent(invoiceEvent(type, { tenantId, subId }), { provider, redis });

    const row = await asUser(userId, (tx) => tx.subscription.findFirstOrThrow());
    expect(row.status).toBe(to);
  });

  // ---------- Trial-will-end email ----------

  it("customer.subscription.trial_will_end sends the tenant owner an email via MailHog", async () => {
    if (env.EMAIL_TRANSPORT !== "mailhog") return; // gate: skip in console-only CI
    const { tenantId, userId, subId, email } = await newTenantWithSub("trialing");
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    const trialEndSec = Math.floor(Date.parse("2027-04-01T00:00:00Z") / 1000);
    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "customer.subscription.trial_will_end",
      data: {
        object: {
          id: subId,
          status: "trialing",
          trial_end: trialEndSec,
          metadata: { tenantId },
        },
      },
    };
    const outcome = await handleStripeEvent(event, { provider, redis });
    expect(outcome.kind).toBe("processed");

    // Poll MailHog for the mail addressed to *this* signup's user (which
    // is the owner-membership user). Filter by recipient — vitest runs
    // test files in parallel and other suites share the sink.
    const deadline = Date.now() + 5000;
    let mail: unknown | null = null;
    while (Date.now() < deadline) {
      const res = await fetch(`${env.MAILHOG_API_URL}/api/v2/messages`);
      const items = (
        (await res.json()) as {
          items: {
            To: { Mailbox: string; Domain: string }[];
            Content: { Headers: Record<string, string[]> };
          }[];
        }
      ).items;
      const matches = items.filter((m) => `${m.To[0]!.Mailbox}@${m.To[0]!.Domain}` === email);
      const found = matches.find((m) => m.Content.Headers.Subject?.[0]?.includes("trial for"));
      if (found) {
        mail = found;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(mail).not.toBeNull();
    const subject = ((mail as { Content: { Headers: Record<string, string[]> } }).Content.Headers
      .Subject ?? [])[0];
    expect(subject).toContain("Dunning test"); // the tenant name from newTenantWithSub
  });
});
