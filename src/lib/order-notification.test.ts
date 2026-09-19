import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { env } from "./env";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import { placeOrder, type ReceiptOrder } from "./order-service";
import { markOrderPaid } from "./connect-service";
import { sendNewOrderNotification } from "./order-notification";
import { NewOrderEmail, newOrderSubject } from "@/emails/new-order-email";

const sample: ReceiptOrder = {
  id: "o1",
  orderNumber: 12,
  tableNumber: "4",
  orderType: "dine_in",
  customerName: "Amir",
  customerPhone: "+49 170 0000000",
  customerEmail: null,
  requestedFor: null,
  deliveryAddress: null,
  paymentStatus: "none",
  discountCents: 0,
  paymentProvider: null,
  totalCents: 2380,
  currency: "EUR",
  createdAt: new Date("2026-09-18T18:00:00Z"),
  venue: { name: "Rangla Punjab", slug: "rangla-punjab", logoKey: null, defaultLocale: "de" },
  items: [{ name: "Butter Chicken", priceCents: 1190, quantity: 2 }],
};

describe("new-order email template", () => {
  it("German dine-in, unpaid: subject carries table + total, body says what to collect", () => {
    expect(newOrderSubject(sample, "de")).toMatch(/^Neue Bestellung Nr\. 0012 · Tisch 4 · 23,80/);
    const html = renderToStaticMarkup(
      NewOrderEmail({ order: sample, locale: "de", kitchenUrl: "https://x/kitchen" }),
    );
    expect(html).toContain("Neue Bestellung Nr. 0012");
    expect(html).toContain("Tisch 4");
    expect(html).toContain("Amir");
    expect(html).toContain('href="tel:+49 170 0000000"');
    expect(html).toContain("2×");
    expect(html).toContain("Butter Chicken");
    expect(html).toMatch(/Noch nicht bezahlt — 23,80/);
    expect(html).toContain('href="https://x/kitchen"');
  });

  it("a reward-paid ticket shows the discount and nothing to collect", () => {
    // The kitchen must never be told to collect money a reward already
    // settled — and the ticket's lines still have to add up to the total.
    const html = renderToStaticMarkup(
      NewOrderEmail({
        order: {
          ...sample,
          discountCents: 2000,
          totalCents: 380,
          paymentStatus: "paid",
          paymentProvider: "voucher",
        },
        locale: "de",
        kitchenUrl: "https://x/kitchen",
      }),
    );
    expect(html).toContain("Gutschein");
    expect(html).toMatch(/−.?20,00/);
    expect(html).toContain("Mit Treuegutschein bezahlt");
    expect(html).not.toMatch(/Noch nicht bezahlt/);
    expect(html).not.toContain("Online bezahlt (Karte)");
  });

  it("English delivery, paid by PayPal: address, requested time, nothing to collect", () => {
    const order: ReceiptOrder = {
      ...sample,
      orderType: "delivery",
      tableNumber: null,
      paymentStatus: "paid",
      paymentProvider: "paypal",
      requestedFor: new Date("2026-09-18T18:30:00Z"),
      deliveryAddress: { street: "Hauptstr. 1", zip: "10115", city: "Berlin", note: "2nd floor" },
    };
    expect(newOrderSubject(order, "en")).toMatch(/^New order #0012 · Delivery · €23\.80/);
    const html = renderToStaticMarkup(
      NewOrderEmail({ order, locale: "en", kitchenUrl: "https://x/kitchen" }),
    );
    expect(html).toContain("Hauptstr. 1, 10115 Berlin");
    expect(html).toContain("2nd floor");
    expect(html).toContain("Wanted for");
    expect(html).toContain("Paid online (PayPal) — nothing to collect.");
  });

  it("follows the venue's language into Spanish and Arabic", () => {
    expect(newOrderSubject(sample, "es")).toMatch(/^Nuevo pedido n\.º 0012 · Mesa 4 · 23,80/);
    const es = renderToStaticMarkup(
      NewOrderEmail({ order: sample, locale: "es", kitchenUrl: "https://x/kitchen" }),
    );
    expect(es).toContain("Nuevo pedido n.º 0012");
    expect(es).toContain("Cliente");
    expect(es).toMatch(/Aún sin pagar: cobrar 23,80/);
    expect(es).not.toContain("Noch nicht bezahlt");

    const ar = renderToStaticMarkup(
      NewOrderEmail({ order: sample, locale: "ar", kitchenUrl: "https://x/kitchen" }),
    );
    expect(ar).toContain('dir="rtl"');
    expect(ar).toContain("طلب جديد رقم 0012");
    expect(ar).toContain("طاولة 4");
  });

  it("dine-in without a table number says so rather than showing a blank", () => {
    const html = renderToStaticMarkup(
      NewOrderEmail({
        order: { ...sample, tableNumber: null },
        locale: "en",
        kitchenUrl: "https://x/kitchen",
      }),
    );
    expect(html).toContain("Dine-in (no table number)");
  });
});

describe.runIf(env.EMAIL_TRANSPORT === "mailhog")("new-order notification delivery", () => {
  const userIds: string[] = [];
  const tenantIds: string[] = [];

  async function fixture(notifyEmails: string[]): Promise<{
    tenantId: string;
    venueId: string;
    publishedVersionId: string;
    itemId: string;
  }> {
    const s = await signupUser({
      email: `notify-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Notify Mail",
    });
    if (!s.ok) throw new Error("signup failed");
    userIds.push(s.userId);
    tenantIds.push(s.tenantId);
    return asTenant(s.tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "Notify Venue",
          slug: `notify-${randomUUID().slice(0, 8)}`,
          currency: "EUR",
          defaultLocale: "de",
          ordering: { notifyEmails },
        },
        select: { id: true },
      });
      const menu = await tx.menu.create({
        data: { tenantId: s.tenantId, venueId: venue.id, name: "Main", isDefault: true },
        select: { id: true },
      });
      const version = await tx.menuVersion.create({
        data: {
          tenantId: s.tenantId,
          menuId: menu.id,
          status: "published",
          publishedAt: new Date(),
        },
        select: { id: true },
      });
      await tx.menu.update({ where: { id: menu.id }, data: { publishedVersion: version.id } });
      const cat = await tx.category.create({
        data: { tenantId: s.tenantId, menuVersionId: version.id, name: "Mains", orderIndex: 0 },
        select: { id: true },
      });
      const item = await tx.item.create({
        data: {
          tenantId: s.tenantId,
          categoryId: cat.id,
          name: "Dal",
          priceCents: 990,
          orderIndex: 0,
        },
        select: { id: true },
      });
      return {
        tenantId: s.tenantId,
        venueId: venue.id,
        publishedVersionId: version.id,
        itemId: item.id,
      };
    });
  }

  /** MailHog returns non-ASCII subjects RFC 2047 Q-encoded ("=?UTF-8?Q?…?="):
   *  underscores are spaces, =XX is a UTF-8 byte. Decode so the assertion
   *  can read the subject the way a mail client shows it. */
  function decodeSubject(raw: string): string {
    return raw
      .split(/\s+(?==\?)/)
      .map((chunk) => {
        const m = /^=\?UTF-8\?Q\?(.*)\?=$/i.exec(chunk);
        if (!m) return chunk;
        const bytes = m[1]!.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, "%$1");
        return decodeURIComponent(bytes);
      })
      .join("");
  }

  async function mailFor(to: string): Promise<{ subject: string }[]> {
    const res = await fetch(`${env.MAILHOG_API_URL}/api/v2/messages`);
    const json = (await res.json()) as {
      items: { Content: { Headers: Record<string, string[]> } }[];
    };
    return json.items
      .filter((m) => (m.Content.Headers.To ?? []).some((h) => h.includes(to)))
      .map((m) => ({ subject: decodeSubject(m.Content.Headers.Subject?.[0] ?? "") }));
  }

  async function cleanup(): Promise<void> {
    for (const tid of tenantIds) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  it("mails every configured inbox; a venue with none configured sends nothing", async () => {
    const a = `chef-${randomUUID()}@ex.com`;
    const b = `office-${randomUUID()}@ex.com`;
    const fx = await fixture([a, b]);
    const placed = await placeOrder(fx, {
      items: [{ itemId: fx.itemId, quantity: 2 }],
      tableNumber: "7",
    });
    if (!placed.ok) throw new Error("order failed");

    expect(await sendNewOrderNotification(fx.tenantId, placed.value.orderId)).toEqual({ sent: 2 });
    const [ma, mb] = await Promise.all([mailFor(a), mailFor(b)]);
    expect(ma.length).toBe(1);
    expect(mb.length).toBe(1);
    expect(ma[0]!.subject).toMatch(/Neue Bestellung Nr\. 0001 · Tisch 7/);

    // Settling an online order alerts too (fire-and-forget from markOrderPaid).
    await asTenant(fx.tenantId, (tx) =>
      tx.order.update({
        where: { id: placed.value.orderId },
        data: { paymentStatus: "pending", paymentProvider: "stripe" },
      }),
    );
    expect(await markOrderPaid(fx.tenantId, placed.value.orderId)).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await mailFor(a)).length).toBe(2);

    const quiet = await fixture([]);
    const q = await placeOrder(quiet, { items: [{ itemId: quiet.itemId, quantity: 1 }] });
    if (!q.ok) throw new Error("order failed");
    expect(await sendNewOrderNotification(quiet.tenantId, q.value.orderId)).toEqual({
      sent: 0,
      reason: "no_recipients",
    });

    await cleanup();
  });
});
