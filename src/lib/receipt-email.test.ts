import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { env } from "./env";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import { placeOrder } from "./order-service";
import { markOrderPaid } from "./connect-service";
import { sendReceiptEmailForOrder } from "./receipt-email";
import { renderToStaticMarkup } from "react-dom/server";
import { ReceiptEmail, receiptSubject } from "@/emails/receipt-email";
import type { ReceiptOrder } from "./order-service";

const sample: ReceiptOrder = {
  id: "o1",
  orderNumber: 12,
  tableNumber: "4",
  orderType: "dine_in",
  customerName: null,
  customerPhone: null,
  customerEmail: "g@ex.com",
  requestedFor: null,
  deliveryAddress: null,
  paymentStatus: "paid",
  paymentProvider: "stripe",
  totalCents: 2380,
  currency: "EUR",
  createdAt: new Date("2026-09-18T18:00:00Z"),
  venue: { name: "Rangla Punjab", slug: "rangla-punjab", logoKey: null, defaultLocale: "de" },
  items: [{ name: "Butter Chicken", priceCents: 1190, quantity: 2 }],
};

describe("receipt email template", () => {
  it("renders German copy with the VAT split and a paid-by-card line", () => {
    const html = renderToStaticMarkup(
      ReceiptEmail({
        order: sample,
        locale: "de",
        receiptUrl: "https://x/r.pdf",
        trackUrl: "https://x/t",
      }),
    );
    expect(receiptSubject(sample, "de")).toBe("Ihre Bestellung Nr. 0012 bei Rangla Punjab");
    expect(html).toContain("Bestellung Nr. 0012");
    expect(html).toContain("MwSt. 19 % (enthalten)");
    // 23,80 gross → 3,80 VAT / 20,00 net at 19 %
    expect(html).toMatch(/3,80/);
    expect(html).toMatch(/20,00/);
    expect(html).toContain("Online bezahlt (Karte).");
    expect(html).toContain("Tisch 4");
    expect(html).toContain('href="https://x/r.pdf"');
  });

  it("renders English copy when asked", () => {
    const html = renderToStaticMarkup(
      ReceiptEmail({
        order: { ...sample, paymentStatus: "none", paymentProvider: null, orderType: "takeaway" },
        locale: "en",
        receiptUrl: "https://x/r.pdf",
        trackUrl: "https://x/t",
      }),
    );
    expect(receiptSubject(sample, "en")).toBe("Your order #0012 at Rangla Punjab");
    expect(html).toContain("VAT 19% (included)");
    expect(html).toContain("Payment is settled at pickup.");
  });
});

describe.runIf(env.EMAIL_TRANSPORT === "mailhog")("receipt email delivery", () => {
  const userIds: string[] = [];
  const tenantIds: string[] = [];

  async function fixture(): Promise<{
    tenantId: string;
    venueId: string;
    publishedVersionId: string;
    itemId: string;
  }> {
    const s = await signupUser({
      email: `rcpt-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Receipt Mail",
    });
    if (!s.ok) throw new Error("signup failed");
    userIds.push(s.userId);
    tenantIds.push(s.tenantId);
    return asTenant(s.tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "Mail Venue",
          slug: `rcpt-${randomUUID().slice(0, 8)}`,
          currency: "EUR",
          defaultLocale: "de",
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

  async function mailFor(to: string): Promise<{ subject: string; body: string }[]> {
    const res = await fetch(`${env.MAILHOG_API_URL}/api/v2/messages`);
    const json = (await res.json()) as {
      items: { Content: { Headers: Record<string, string[]>; Body: string } }[];
    };
    return json.items
      .filter((m) => (m.Content.Headers.To ?? []).some((h) => h.includes(to)))
      .map((m) => ({ subject: m.Content.Headers.Subject?.[0] ?? "", body: m.Content.Body }));
  }

  it("mails the receipt to the guest's address; skips silently when none was given", async () => {
    const fx = await fixture();
    const to = `guest-${randomUUID()}@ex.com`;
    const placed = await placeOrder(fx, {
      items: [{ itemId: fx.itemId, quantity: 2 }],
      customerEmail: to,
    });
    if (!placed.ok) throw new Error("order failed");

    const sent = await sendReceiptEmailForOrder(fx.tenantId, placed.value.orderId);
    expect(sent).toEqual({ sent: true });
    const mails = await mailFor(to);
    expect(mails.length).toBe(1);
    expect(mails[0]!.subject).toMatch(/Bestellung Nr\. 0001 bei Mail Venue/);

    const noEmail = await placeOrder(fx, { items: [{ itemId: fx.itemId, quantity: 1 }] });
    if (!noEmail.ok) throw new Error("order failed");
    expect(await sendReceiptEmailForOrder(fx.tenantId, noEmail.value.orderId)).toEqual({
      sent: false,
      reason: "no_email",
    });

    // Settling an online order mails too (fire-and-forget from markOrderPaid).
    await asTenant(fx.tenantId, (tx) =>
      tx.order.update({
        where: { id: placed.value.orderId },
        data: { paymentStatus: "pending", paymentProvider: "stripe" },
      }),
    );
    expect(await markOrderPaid(fx.tenantId, placed.value.orderId)).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await mailFor(to)).length).toBe(2);

    for (const tid of tenantIds) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
});
