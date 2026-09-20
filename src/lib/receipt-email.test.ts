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
  discountCents: 0,
  discountPoints: 0,
  giftCardDiscountCents: 0,
  giftCardLast4: null,
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

  it("shows the reward as its own row and says a reward paid, not a card", () => {
    // €24.90 of food, a €20 reward, €4.90 charged: the lines keep their
    // menu prices and the VAT is computed on what the guest actually paid.
    const html = renderToStaticMarkup(
      ReceiptEmail({
        order: { ...sample, discountCents: 2000, discountPoints: 100, totalCents: 490 },
        locale: "de",
        receiptUrl: "https://x/r.pdf",
        trackUrl: "https://x/t",
      }),
    );
    expect(html).toContain("Gutschein");
    // The POINTS are on the label, not just the money off: a guest reading
    // this a week later cannot otherwise tell what the reward cost them.
    expect(html).toContain("Gutschein · 100 Punkte");
    expect(html).toMatch(/−.?20,00/);
    expect(html).toMatch(/4,90/);

    // An order placed before the column existed carries 0 points, and gets
    // the plain label rather than "Gutschein · 0 Punkte".
    const older = renderToStaticMarkup(
      ReceiptEmail({
        order: { ...sample, discountCents: 2000, discountPoints: 0, totalCents: 490 },
        locale: "de",
        receiptUrl: "https://x/r.pdf",
        trackUrl: "https://x/t",
      }),
    );
    expect(older).toContain("Gutschein");
    expect(older).not.toContain("Punkte");
    // 4,90 gross → 0,78 VAT at 19 %, i.e. the tax follows the discount.
    expect(html).toMatch(/0,78/);

    const free = renderToStaticMarkup(
      ReceiptEmail({
        order: {
          ...sample,
          discountCents: 2380,
          discountPoints: 100,
          totalCents: 0,
          paymentProvider: "voucher",
        },
        locale: "de",
        receiptUrl: "https://x/r.pdf",
        trackUrl: "https://x/t",
      }),
    );
    // A reward that covered the WHOLE bill keeps both: the "paid with
    // your reward" line AND the row saying what it cost.
    expect(free).toContain("Mit Ihrem Gutschein bezahlt");
    expect(free).toContain("Gutschein · 100 Punkte");
    expect(free).not.toContain("Online bezahlt (Karte).");
  });

  it("shows the gift card as its own row, under the reward", () => {
    // Both instruments on one order: a €10 reward and a €10 gift card off
    // €24.90 of food. Two rows, not one merged "discount" — the guest is
    // owed a receipt that says which was which, and the masked last 4 say
    // WHICH card, since a guest may hold several.
    const html = renderToStaticMarkup(
      ReceiptEmail({
        order: {
          ...sample,
          discountCents: 1000,
          discountPoints: 100,
          giftCardDiscountCents: 1000,
          giftCardLast4: "EFGH",
          totalCents: 490,
        },
        locale: "de",
        receiptUrl: "https://x/r.pdf",
        trackUrl: "https://x/t",
      }),
    );
    expect(html).toContain("Geschenkgutschein ····EFGH");
    expect(html).toMatch(/−.?10,00/);
    // The reward row is still there, above it.
    expect(html).toContain("Gutschein · 100 Punkte");

    // A gift card that covered the WHOLE bill says so in the pill, rather
    // than claiming a card was charged.
    const free = renderToStaticMarkup(
      ReceiptEmail({
        order: {
          ...sample,
          giftCardDiscountCents: 2380,
          giftCardLast4: "EFGH",
          totalCents: 0,
          paymentProvider: "gift_card",
        },
        locale: "de",
        receiptUrl: "https://x/r.pdf",
        trackUrl: "https://x/t",
      }),
    );
    expect(free).toContain("Bezahlt · Geschenkgutschein");
    expect(free).toContain("Geschenkgutschein ····EFGH");
    expect(free).not.toContain("Online bezahlt (Karte).");
  });

  it("renders Spanish, Italian and Arabic receipts end to end", () => {
    const cases = [
      {
        locale: "es" as const,
        subject: "Tu pedido n.º 0012 en Rangla Punjab",
        vat: "IVA 19 % (incluido)",
        paid: "Pagado online (tarjeta).",
      },
      {
        locale: "it" as const,
        subject: "Il tuo ordine n. 0012 da Rangla Punjab",
        vat: "IVA 19% (inclusa)",
        paid: "Pagato online (carta).",
      },
      {
        locale: "ar" as const,
        subject: "طلبك رقم 0012 لدى Rangla Punjab",
        vat: "ضريبة القيمة المضافة 19% (مشمولة)",
        paid: "مدفوع عبر الإنترنت (بطاقة).",
      },
    ];
    for (const c of cases) {
      expect(receiptSubject(sample, c.locale)).toBe(c.subject);
      const html = renderToStaticMarkup(
        ReceiptEmail({
          order: sample,
          locale: c.locale,
          receiptUrl: "https://x/r.pdf",
          trackUrl: "https://x/t",
        }),
      );
      expect(html).toContain(c.vat);
      expect(html).toContain(c.paid);
      expect(html).toContain(`lang="${c.locale}"`);
      // German is the venue's language, not the guest's — it must not leak
      // into a receipt that was asked for in another one.
      expect(html).not.toContain("Vielen Dank");
    }
  });

  it("marks the Arabic receipt right-to-left so mail clients lay it out correctly", () => {
    const html = renderToStaticMarkup(
      ReceiptEmail({
        order: sample,
        locale: "ar",
        receiptUrl: "https://x/r.pdf",
        trackUrl: "https://x/t",
      }),
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("text-align:left"); // amounts mirror with the text
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

  it("adds a quiet Rate-us-on-Google button when the venue has a review link", () => {
    const review = "https://search.google.com/local/writereview?placeid=ChIJabc";
    for (const [locale, label] of [
      ["en", "Rate us on Google"],
      ["de", "Bewerten Sie uns bei Google"],
      ["es", "Valóranos en Google"],
      ["it", "Valutaci su Google"],
      ["ar", "قيّمنا على Google"],
    ] as const) {
      const html = renderToStaticMarkup(
        ReceiptEmail({
          order: sample,
          locale,
          receiptUrl: "https://x/r.pdf",
          trackUrl: "https://x/t",
          reviewUrl: review,
        }),
      );
      expect(html).toContain(`href="${review}"`);
      expect(html).toContain(label);
      // Last, after the receipt's own two buttons — this mail is a
      // receipt first and an ask second.
      expect(html.indexOf(review)).toBeGreaterThan(html.indexOf("https://x/t"));
    }
  });

  it("leaves the review button out when there is no link to send the guest to", () => {
    const html = renderToStaticMarkup(
      ReceiptEmail({
        order: sample,
        locale: "en",
        receiptUrl: "https://x/r.pdf",
        trackUrl: "https://x/t",
      }),
    );
    expect(html).not.toContain("Rate us on Google");
    expect(html).not.toContain("writereview");
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

  /** MailHog hands back the raw quoted-printable body, where every "="
   *  is `=3D` and long lines are broken with a trailing "=". A URL is the
   *  one thing that survives neither, so decode before looking for one. */
  function decodeQp(body: string): string {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  }

  it("always carries the Rate-us button — even for an order already tapped through", async () => {
    const fx = await fixture();
    await asTenant(fx.tenantId, (tx) =>
      tx.venue.updateMany({
        where: { id: fx.venueId },
        data: { googlePlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4" },
      }),
    );
    const to = `reviewed-${randomUUID()}@ex.com`;
    const placed = await placeOrder(fx, {
      items: [{ itemId: fx.itemId, quantity: 1 }],
      customerEmail: to,
    });
    if (!placed.ok) throw new Error("order failed");

    // The guest has ALREADY followed the review link once. On the
    // tracker, the account page and the app that retires the ask — but
    // a receipt is a fixed artefact, sent before anyone tapped anything
    // and unable to learn about a later tap, so the button stays. The
    // owner's rule is explicit about this: the email always offers it.
    await asTenant(fx.tenantId, (tx) =>
      tx.order.updateMany({
        where: { id: placed.value.orderId },
        data: { reviewClickedAt: new Date() },
      }),
    );

    expect(await sendReceiptEmailForOrder(fx.tenantId, placed.value.orderId)).toEqual({
      sent: true,
    });
    const body = decodeQp((await mailFor(to))[0]!.body);
    // And it points at OUR tracked redirect, not at Google directly —
    // that hop is the only way a tap is ever observed.
    expect(body).toContain(`/api/v1/orders/${placed.value.orderId}/review?token=`);
    expect(body).not.toContain("search.google.com/local/writereview");
    expect(body).toContain("Bewerten Sie uns bei Google");
  });

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
