import { env } from "./env";
import { createLogger } from "./logger";
import { captureException } from "./observability";
import { asTenant, resolveActiveTenantId } from "./tenant";

const log = createLogger();

/**
 * "Tell me on my phone when an order lands."
 *
 * The transport is Expo's push service, not APNs or FCM. Our server POSTs
 * to `exp.host` and Expo fans out to Apple and Google using the push key
 * and the FCM service account the owner uploads to EAS — so this
 * deployment holds neither credential, and a lost phone or a rotated
 * Apple key never becomes a server redeploy.
 *
 * Nothing here is allowed to break an order. Every entry point swallows
 * its failures and logs: a notification is a courtesy on top of a
 * transaction that already committed, and a push outage turning a
 * successful checkout into a 500 would be the worst possible trade.
 *
 * Provider seam, same shape as the Stripe and PayPal ones: unset config ⇒
 * an in-memory fake that records sends. That is the default in dev, in CI,
 * and in a deployment whose push credentials are not in place yet — the
 * app still registers a token, the server still fans out, and nothing
 * leaves the process.
 */

export type PushPlatform = "ios" | "android" | "web";

/** What a caller asks for. `to` is filled in per device by the fan-out. */
export interface StaffPushMessage {
  title: string;
  body: string;
  /** String-valued only: this rides through APNs/FCM as a JSON payload and
   *  the app branches on `data.kind`. */
  data?: Record<string, string>;
}

/** One message addressed to one device — what the provider actually sends. */
export interface PushMessage extends StaffPushMessage {
  to: string;
}

/**
 * Expo's per-message receipt, trimmed to what we act on. Tickets come back
 * positionally, one per message, so index `i` answers for `messages[i]`.
 */
export interface PushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  /** `DeviceNotRegistered` is the only one with a consequence: the address
   *  is dead and must stop costing us a request per order. */
  error?: string;
}

export interface PushProvider {
  readonly mode: "real" | "fake";
  /** Never throws: a transport failure comes back as error tickets, so the
   *  caller's book-keeping is the same either way. */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

/** Expo refuses more than 100 messages in one request. */
const CHUNK = 100;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * The real transport. One POST per chunk, sequentially — the fan-out for a
 * single restaurant is a handful of devices, and a burst of parallel
 * requests would only buy us Expo's rate limiter.
 */
export class ExpoPushProvider implements PushProvider {
  readonly mode = "real" as const;

  constructor(private readonly accessToken?: string) {}

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += CHUNK) {
      const chunk = messages.slice(i, i + CHUNK);
      tickets.push(...(await this.sendChunk(chunk)));
    }
    return tickets;
  }

  private async sendChunk(chunk: PushMessage[]): Promise<PushTicket[]> {
    // Whatever goes wrong — DNS, a 502, a body that is not the shape we
    // expect — every message in the chunk gets an error ticket. The caller
    // treats that as "not delivered", which is true, and does not disable
    // anything, which is also right: a transport hiccup is not a dead
    // device.
    const failed = (message: string): PushTicket[] =>
      chunk.map(() => ({ status: "error" as const, message }));
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(
          chunk.map((m) => ({
            to: m.to,
            title: m.title,
            body: m.body,
            ...(m.data ? { data: m.data } : {}),
            sound: "default",
            priority: "high",
            // Matches the Android channel the app creates; ignored on iOS.
            channelId: "orders",
          })),
        ),
      });
      if (!res.ok) return failed(`expo_http_${res.status}`);
      const json = (await res.json()) as {
        data?: { status?: string; id?: string; message?: string; details?: { error?: string } }[];
        errors?: { message?: string }[];
      };
      if (!Array.isArray(json.data)) {
        return failed(json.errors?.[0]?.message ?? "expo_bad_response");
      }
      return chunk.map((_, i) => {
        const ticket = json.data?.[i];
        if (!ticket) return { status: "error" as const, message: "expo_missing_ticket" };
        return ticket.status === "ok"
          ? { status: "ok" as const, id: ticket.id }
          : {
              status: "error" as const,
              message: ticket.message,
              error: ticket.details?.error,
            };
      });
    } catch (err) {
      captureException(err, { where: "push-service", count: chunk.length });
      return failed("expo_unreachable");
    }
  }
}

/**
 * The default. Records what would have been sent so tests can assert on it
 * and a developer can see the fan-out in `__fakePush().sent` without any
 * credentials. Also the honest production behaviour before the Apple/FCM
 * keys exist: the app registers, the server fans out, nothing is delivered.
 */
export class FakePushProvider implements PushProvider {
  readonly mode = "fake" as const;
  /** Every message handed to `send`, oldest first. */
  readonly sent: PushMessage[] = [];

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    log.info("push.fake_sent", { count: messages.length });
    return messages.map((_, i) => ({ status: "ok" as const, id: `fake-${this.sent.length - i}` }));
  }

  reset(): void {
    this.sent.length = 0;
  }
}

// Cached on globalThis so HMR and repeated imports share one recorder —
// otherwise a test would assert against a different fake than the one the
// route used.
const globalForPush = globalThis as unknown as {
  pushProvider?: PushProvider;
  pushFake?: FakePushProvider;
};

/**
 * The fake, for tests and for a dev who wants to see the fan-out. Always
 * the same instance the selector hands out when push is disabled.
 */
export function __fakePush(): FakePushProvider {
  globalForPush.pushFake ??= new FakePushProvider();
  return globalForPush.pushFake;
}

/** Real transport only on an explicit `EXPO_PUSH_ENABLED=true`. */
export function getPushProvider(): PushProvider {
  if (env.EXPO_PUSH_ENABLED !== "true") return __fakePush();
  globalForPush.pushProvider ??= new ExpoPushProvider(env.EXPO_ACCESS_TOKEN);
  return globalForPush.pushProvider;
}

/** Expo's own token format. Both spellings are live in the wild. */
export const EXPO_PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

export interface RegisterDeviceInput {
  token: string;
  platform: PushPlatform;
  appVersion?: string;
}

export type RegisterResult =
  { ok: true; created: boolean } | { ok: false; error: "no_tenant" | "token_taken" };

/**
 * Remember this installation. Idempotent on the token: the app calls it on
 * every staff sign-in and after every permission grant, and the second call
 * must be an update, not a duplicate — and must clear `disabledAt`, because
 * "I just granted notifications again" is exactly the case a previously
 * dead token comes back to life.
 */
export async function registerStaffDevice(
  userId: string,
  input: RegisterDeviceInput,
): Promise<RegisterResult> {
  const tenantId = await resolveActiveTenantId(userId);
  if (!tenantId) return { ok: false, error: "no_tenant" };

  return asTenant(tenantId, async (tx) => {
    const now = new Date();
    const fields = {
      userId,
      platform: input.platform,
      appVersion: input.appVersion ?? null,
      lastSeenAt: now,
      disabledAt: null,
    };
    // updateMany-then-create rather than `upsert`: the unique key is
    // global but RLS scopes what we can SEE, so an upsert on a token held
    // by another tenant would read as "absent" and then fail the insert.
    // This way the failure is explicit and the caller hears about it.
    const updated = await tx.staffDevice.updateMany({
      where: { expoPushToken: input.token },
      data: fields,
    });
    if (updated.count > 0) {
      log.info("push.device_updated", { userId, tenantId, platform: input.platform });
      return { ok: true, created: false };
    }
    try {
      await tx.staffDevice.create({
        data: { tenantId, expoPushToken: input.token, ...fields },
      });
    } catch {
      // Only a unique violation can land here: the token belongs to a row
      // this tenant cannot see. Refusing beats stealing it.
      log.warn("push.device_token_taken", { userId, tenantId });
      return { ok: false, error: "token_taken" };
    }
    log.info("push.device_registered", { userId, tenantId, platform: input.platform });
    return { ok: true, created: true };
  });
}

/**
 * Forget it — staff sign-out, or the owner turning notifications off. Only
 * the user's own devices, so one account can never silence another's
 * handset by guessing a token. Returns false when there was nothing to
 * forget, which is a perfectly ordinary outcome (a second sign-out).
 */
export async function unregisterStaffDevice(userId: string, token: string): Promise<boolean> {
  const tenantId = await resolveActiveTenantId(userId);
  if (!tenantId) return false;
  const removed = await asTenant(tenantId, (tx) =>
    tx.staffDevice.deleteMany({ where: { userId, expoPushToken: token } }),
  );
  if (removed.count > 0) log.info("push.device_unregistered", { userId, tenantId });
  return removed.count > 0;
}

export interface PushFanoutResult {
  sent: number;
  failed: number;
  disabled: number;
  reason?: "no_devices" | "error";
}

/**
 * Buzz every live device belonging to every OWNER of this tenant.
 *
 * Owners, not "everyone with a row": the devices table is written by the
 * staff routes, which only an owner can reach, but membership can be
 * revoked after a device is registered and the fan-out must follow the
 * membership rather than the leftover row.
 *
 * Never throws. Returns a tally so the caller can log it if it cares; the
 * two production call sites do not, they `void` it.
 */
export async function sendStaffPush(
  tenantId: string,
  message: StaffPushMessage,
): Promise<PushFanoutResult> {
  try {
    const devices = await asTenant(tenantId, async (tx) => {
      const owners = await tx.membership.findMany({
        where: { role: "owner" },
        select: { userId: true },
      });
      if (owners.length === 0) return [];
      return tx.staffDevice.findMany({
        where: { userId: { in: owners.map((o) => o.userId) }, disabledAt: null },
        select: { id: true, expoPushToken: true },
      });
    });
    if (devices.length === 0) return { sent: 0, failed: 0, disabled: 0, reason: "no_devices" };

    const provider = getPushProvider();
    const tickets = await provider.send(devices.map((d) => ({ to: d.expoPushToken, ...message })));

    let sent = 0;
    const dead: string[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === "ok") {
        sent += 1;
        return;
      }
      // The app was deleted, the token rotated, or notifications were
      // revoked. Park the row instead of deleting it: a re-register
      // revives the same address, and the timestamp says why it went quiet.
      if (ticket.error === "DeviceNotRegistered") {
        const id = devices[i]?.id;
        if (id) dead.push(id);
      }
    });

    if (dead.length > 0) {
      await asTenant(tenantId, (tx) =>
        tx.staffDevice.updateMany({
          where: { id: { in: dead } },
          data: { disabledAt: new Date() },
        }),
      );
      log.info("push.devices_disabled", { tenantId, count: dead.length });
    }
    const failed = tickets.length - sent;
    if (sent > 0) log.info("push.sent", { tenantId, sent, of: devices.length });
    if (failed > 0) log.warn("push.send_failed", { tenantId, failed });
    return { sent, failed, disabled: dead.length };
  } catch (err) {
    captureException(err, { tenantId, where: "push-service" });
    log.warn("push.send_failed", { tenantId });
    return { sent: 0, failed: 0, disabled: 0, reason: "error" };
  }
}

/* ---------------------------------------------------------------- *
 * The two things worth waking a phone for.                          *
 * ---------------------------------------------------------------- */

/** English on purpose: the push text is three words on a lock screen, the
 *  app's own screens carry the localised copy, and a locale round-trip per
 *  order is not worth a second query on a fire-and-forget path. */
const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

function formatTotal(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * "New order #12 — Delivery · €23.80". Fired next to the owner's email, on
 * exactly the same two triggers: a cash/voucher order at placement, an
 * online order once the money has moved.
 */
export async function sendNewOrderPush(tenantId: string, orderId: string): Promise<void> {
  try {
    const order = await asTenant(tenantId, (tx) =>
      tx.order.findFirst({
        where: { id: orderId },
        select: { orderNumber: true, orderType: true, totalCents: true, currency: true },
      }),
    );
    if (!order) return;
    const label = ORDER_TYPE_LABEL[order.orderType] ?? order.orderType;
    await sendStaffPush(tenantId, {
      title: `New order #${order.orderNumber}`,
      body: `${label} · ${formatTotal(order.totalCents, order.currency)}`,
      data: { kind: "order", orderId },
    });
  } catch (err) {
    captureException(err, { tenantId, orderId, where: "push-service" });
  }
}

/**
 * "Order #12 cancelled by the guest" — a cash order the guest called off
 * inside their cancel window. The kitchen already had it, so this is the
 * cue to stop cooking.
 */
export async function sendGuestCancelPush(tenantId: string, orderId: string): Promise<void> {
  try {
    const order = await asTenant(tenantId, (tx) =>
      tx.order.findFirst({
        where: { id: orderId },
        select: { orderNumber: true, orderType: true, totalCents: true, currency: true },
      }),
    );
    if (!order) return;
    const label = ORDER_TYPE_LABEL[order.orderType] ?? order.orderType;
    await sendStaffPush(tenantId, {
      title: `Order #${order.orderNumber} cancelled by the guest`,
      body: `${label} · ${formatTotal(order.totalCents, order.currency)} · cash`,
      data: { kind: "order", orderId },
    });
  } catch (err) {
    captureException(err, { tenantId, orderId, where: "push-service" });
  }
}

/**
 * "Problem reported on #12". Fired wherever the complaint email is — on the
 * first guest message and on every follow-up, because "they replied and are
 * still waiting" is as urgent as the original.
 */
export async function sendNewIssuePush(tenantId: string, issueId: string): Promise<void> {
  try {
    const issue = await asTenant(tenantId, (tx) =>
      tx.orderIssue.findFirst({
        where: { id: issueId },
        select: { order: { select: { orderNumber: true } } },
      }),
    );
    if (!issue) return;
    await sendStaffPush(tenantId, {
      title: `Problem reported on #${issue.order.orderNumber}`,
      body: "A guest is waiting for an answer.",
      data: { kind: "issue", issueId },
    });
  } catch (err) {
    captureException(err, { tenantId, issueId, where: "push-service" });
  }
}
