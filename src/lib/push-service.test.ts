import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { signupUser } from "./auth-service";
import { prisma } from "./db";
import {
  EXPO_PUSH_TOKEN_RE,
  FakePushProvider,
  __fakePush,
  getPushProvider,
  registerStaffDevice,
  sendNewIssuePush,
  sendNewOrderPush,
  sendStaffPush,
  unregisterStaffDevice,
} from "./push-service";
import { asTenant } from "./tenant";

/**
 * The push fan-out, on the fake provider.
 *
 * The assertions that matter are the ones about what does NOT happen: a
 * tenant with no devices sends nothing, a disabled device is skipped, a
 * `DeviceNotRegistered` ticket parks the row, and nothing anywhere throws
 * — because every caller is a `void` on a path that has already committed.
 */

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

describe("expo push token shape", () => {
  it("accepts both spellings and rejects everything else", () => {
    expect(EXPO_PUSH_TOKEN_RE.test(TOKEN_A)).toBe(true);
    expect(EXPO_PUSH_TOKEN_RE.test(TOKEN_B)).toBe(true);
    for (const bad of [
      "",
      "ExponentPushToken[]",
      "ExponentPushToken[abc",
      "fcm:abc",
      "ExponentPushToken[abc] ",
      `ExponentPushToken[abc]\nExponentPushToken[def]`,
    ]) {
      expect(EXPO_PUSH_TOKEN_RE.test(bad)).toBe(false);
    }
  });
});

describe("push provider selection", () => {
  it("rides the fake while EXPO_PUSH_ENABLED is unset, and hands out one recorder", () => {
    expect(process.env.EXPO_PUSH_ENABLED).toBeUndefined();
    const provider = getPushProvider();
    expect(provider.mode).toBe("fake");
    expect(provider).toBe(__fakePush());
  });

  it("records every message and answers an ok ticket per message", async () => {
    const fake = new FakePushProvider();
    const tickets = await fake.send([
      { to: TOKEN_A, title: "a", body: "1" },
      { to: TOKEN_B, title: "b", body: "2", data: { kind: "order", orderId: "o1" } },
    ]);
    expect(tickets.map((t) => t.status)).toEqual(["ok", "ok"]);
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[1]).toMatchObject({ to: TOKEN_B, data: { kind: "order" } });
    fake.reset();
    expect(fake.sent).toHaveLength(0);
  });
});

describe("staff device registration + fan-out", () => {
  const userIds: string[] = [];
  const tenantIds: string[] = [];
  let tenantId: string;
  let userId: string;
  // Fresh tokens per test: `expo_push_token` is UNIQUE GLOBALLY, so a
  // leftover row from an earlier tenant would make the next registration
  // look like a stolen token rather than a new handset.
  let tokenA: string;
  let tokenB: string;

  async function tenant(): Promise<{ tenantId: string; userId: string }> {
    const s = await signupUser({
      email: `push-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Push Test",
    });
    if (!s.ok) throw new Error("signup failed");
    userIds.push(s.userId);
    tenantIds.push(s.tenantId);
    return { tenantId: s.tenantId, userId: s.userId };
  }

  beforeEach(async () => {
    __fakePush().reset();
    const fresh = await tenant();
    tenantId = fresh.tenantId;
    userId = fresh.userId;
    tokenA = `ExponentPushToken[${randomUUID()}]`;
    tokenB = `ExpoPushToken[${randomUUID()}]`;
  });

  afterAll(async () => {
    for (const tid of tenantIds) {
      await asTenant(tid, (tx) => tx.staffDevice.deleteMany({}));
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("registers a device, buzzes it, and forgets it on sign-out", async () => {
    expect(await registerStaffDevice(userId, { token: tokenA, platform: "ios" })).toEqual({
      ok: true,
      created: true,
    });

    const result = await sendStaffPush(tenantId, {
      title: "New order #1",
      body: "Delivery · €12.00",
      data: { kind: "order", orderId: "o1" },
    });
    expect(result).toMatchObject({ sent: 1, failed: 0, disabled: 0 });
    expect(__fakePush().sent).toHaveLength(1);
    expect(__fakePush().sent[0]).toMatchObject({
      to: tokenA,
      title: "New order #1",
      data: { kind: "order", orderId: "o1" },
    });

    expect(await unregisterStaffDevice(userId, tokenA)).toBe(true);
    // Idempotent: a second sign-out is not an error.
    expect(await unregisterStaffDevice(userId, tokenA)).toBe(false);

    __fakePush().reset();
    expect(await sendStaffPush(tenantId, { title: "x", body: "y" })).toMatchObject({
      sent: 0,
      reason: "no_devices",
    });
    expect(__fakePush().sent).toHaveLength(0);
  });

  it("re-registering the same token updates in place and revives a disabled row", async () => {
    await registerStaffDevice(userId, { token: tokenA, platform: "ios", appVersion: "1.0.0" });
    await asTenant(tenantId, (tx) =>
      tx.staffDevice.updateMany({ data: { disabledAt: new Date() } }),
    );

    // A disabled device is skipped entirely — the row is parked, not deleted.
    expect(await sendStaffPush(tenantId, { title: "x", body: "y" })).toMatchObject({
      sent: 0,
      reason: "no_devices",
    });

    expect(
      await registerStaffDevice(userId, {
        token: tokenA,
        platform: "android",
        appVersion: "1.1.0",
      }),
    ).toEqual({ ok: true, created: false });

    const rows = await asTenant(tenantId, (tx) => tx.staffDevice.findMany({}));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform: "android", appVersion: "1.1.0", disabledAt: null });

    __fakePush().reset();
    expect(await sendStaffPush(tenantId, { title: "x", body: "y" })).toMatchObject({ sent: 1 });
  });

  it("a token already held by another tenant is refused, not stolen", async () => {
    await registerStaffDevice(userId, { token: tokenA, platform: "ios" });
    const other = await tenant();
    expect(await registerStaffDevice(other.userId, { token: tokenA, platform: "ios" })).toEqual({
      ok: false,
      error: "token_taken",
    });
    const mine = await asTenant(tenantId, (tx) => tx.staffDevice.findMany({}));
    expect(mine[0]?.userId).toBe(userId);
  });

  it("parks a DeviceNotRegistered token and leaves the healthy one alone", async () => {
    await registerStaffDevice(userId, { token: tokenA, platform: "ios" });
    await registerStaffDevice(userId, { token: tokenB, platform: "android" });

    // A provider that answers exactly the way Expo does for a deleted app.
    const dead = __fakePush();
    const original = dead.send.bind(dead);
    dead.send = async (messages) => {
      await original(messages);
      return messages.map((m) =>
        m.to === tokenA
          ? { status: "error" as const, message: "not registered", error: "DeviceNotRegistered" }
          : { status: "ok" as const, id: "t" },
      );
    };
    try {
      const result = await sendStaffPush(tenantId, { title: "x", body: "y" });
      expect(result).toMatchObject({ sent: 1, failed: 1, disabled: 1 });
    } finally {
      dead.send = original;
    }

    const rows = await asTenant(tenantId, (tx) =>
      tx.staffDevice.findMany({ select: { expoPushToken: true, disabledAt: true } }),
    );
    expect(rows.find((r) => r.expoPushToken === tokenA)?.disabledAt).not.toBeNull();
    expect(rows.find((r) => r.expoPushToken === tokenB)?.disabledAt).toBeNull();
  });

  it("never throws on a tenant that does not exist, or an order/issue that does not", async () => {
    // An unknown tenant is not an error, it is a tenant with no owners —
    // RLS answers "no rows" and the fan-out has nothing to do.
    await expect(sendStaffPush("t-nope-nope", { title: "x", body: "y" })).resolves.toMatchObject({
      sent: 0,
      reason: "no_devices",
    });
    await expect(sendNewOrderPush(tenantId, "missing")).resolves.toBeUndefined();
    await expect(sendNewIssuePush(tenantId, "missing")).resolves.toBeUndefined();
    expect(__fakePush().sent).toHaveLength(0);
  });
});
