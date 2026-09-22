import type { ReceiptOrder } from "@/lib/order-service";
import { formatPrice } from "@/lib/public-menu";
import { receiptCopy } from "@/lib/i18n/emails";
import { dirFor, type UiLocale } from "@/lib/locales";
import { vatFromGross } from "@/lib/vat";

/**
 * The order e-mail — what a guest receives the moment they order (cash) or
 * once an online payment settles. The owner's design (2026-09-22): brand
 * header, green "Thank you" card, the order card, a payment line, three
 * promises, and a dark-green footer with the restaurant's address, phone
 * and site.
 *
 * Built for mail clients, not browsers: tables for layout, inline styles,
 * system fonts. The brand lettering (chunky logo type, script tagline) is
 * ONE image (`/brand/email-header.png`) because custom fonts don't survive
 * Gmail/Outlook. Everything else is live text in the guest's language
 * (`src/lib/i18n/emails.ts`); `dir` flips the whole mail for Arabic.
 *
 * Same numbers as the PDF: gross prices, VAT shown as contained.
 */
export interface ReceiptEmailProps {
  order: ReceiptOrder;
  locale: UiLocale;
  receiptUrl: string;
  trackUrl: string;
  /** Google's write-a-review form for this venue, or null when the owner
   *  has no Place ID saved / switched the rating off. */
  reviewUrl?: string | null;
  /** Absolute site origin for the header image and the footer's web link.
   *  Optional so fixtures keep working; the mailer always passes it. */
  siteBase?: string;
}

const C = {
  page: "#f3f5ef",
  card: "#ffffff",
  line: "#e3e8de",
  greenSoft: "#eaf4e2",
  green: "#1e5b2c",
  greenDark: "#0f3d1f",
  ink: "#1f2a1f",
  muted: "#5f6b5f",
  lime: "#c9e265",
  warnBg: "#fde8e8",
  warnInk: "#a4231b",
  okBg: "#e3f2e1",
  okInk: "#1e5b2c",
};
const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

function orderNo(order: ReceiptOrder): string {
  return String(order.orderNumber).padStart(4, "0");
}

export function receiptSubject(order: ReceiptOrder, locale: UiLocale): string {
  return receiptCopy(locale).subject(orderNo(order), order.venue.name);
}

function LinkButton({
  href,
  label,
  solid = false,
}: {
  href: string;
  label: string;
  solid?: boolean;
}): React.ReactElement {
  return (
    <a
      href={href}
      style={{
        display: "inline-block",
        margin: "6px 4px",
        padding: "12px 20px",
        borderRadius: 999,
        fontFamily: FONT,
        fontSize: 14,
        fontWeight: 700,
        textDecoration: "none",
        backgroundColor: solid ? C.green : C.card,
        color: solid ? "#ffffff" : C.green,
        border: `2px solid ${C.green}`,
      }}
    >
      {label}
    </a>
  );
}

export function ReceiptEmail({
  order,
  locale,
  receiptUrl,
  trackUrl,
  reviewUrl = null,
  siteBase = "",
}: ReceiptEmailProps): React.ReactElement {
  const t = receiptCopy(locale);
  const dir = dirFor(locale);
  const start = dir === "rtl" ? ("right" as const) : ("left" as const);
  const end = dir === "rtl" ? ("left" as const) : ("right" as const);
  const money = (cents: number): string => formatPrice(cents, order.currency, locale);
  const vat = vatFromGross(order.totalCents);
  const net = order.totalCents - vat;
  const paid = order.paymentStatus === "paid";
  // A reward or gift card that covered the whole bill is "paid" without a
  // card ever being touched — the line names what actually paid.
  const paymentLine = paid
    ? order.paymentProvider === "gift_card"
      ? t.paidWithGiftCard
      : order.paymentProvider === "voucher"
        ? t.paidVoucher
        : order.paymentProvider === "paypal"
          ? t.paidPaypal
          : t.paidCard
    : order.orderType === "delivery"
      ? t.unpaidDelivery
      : order.orderType === "takeaway"
        ? t.unpaidPickup
        : t.unpaidDineIn;
  const placed = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "Europe/Berlin",
  }).format(order.createdAt);
  const placedTime = new Intl.DateTimeFormat(locale, {
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(order.createdAt);
  const when = order.requestedFor
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Berlin",
      }).format(order.requestedFor)
    : t.asap;
  const whereLine =
    order.orderType === "dine_in"
      ? order.tableNumber
        ? `🍽️ ${t.table} ${order.tableNumber}`
        : null
      : `${order.orderType === "delivery" ? "🛵" : "🛍️"} ${
          order.orderType === "delivery" ? t.delivery : t.pickup
        } · ${t.planned} ${when}`;

  const footer = order.venueFooter ?? { address: null, phone: null, phoneHref: null };
  const site = siteBase.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const cell = { fontFamily: FONT, color: C.ink, fontSize: 15, padding: "10px 16px" };
  // A green band across two cells: round only the outer corners, so it
  // reads as one pill in either reading direction.
  const bandStart = dir === "rtl" ? "0 10px 10px 0" : "10px 0 0 10px";
  const bandEnd = dir === "rtl" ? "10px 0 0 10px" : "0 10px 10px 0";
  const row = (label: React.ReactNode, value: string, style: object = {}): React.ReactElement => (
    <tr>
      <td style={{ ...cell, textAlign: start, ...style }}>{label}</td>
      <td style={{ ...cell, textAlign: end, whiteSpace: "nowrap", ...style }}>{value}</td>
    </tr>
  );

  return (
    <html lang={locale} dir={dir}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <meta name="color-scheme" content="light" />
        <title>{t.heading(orderNo(order))}</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: C.page }}>
        {/* Preheader: what most inboxes show beside the subject. */}
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden", opacity: 0 }}>
          {t.received} {t.heading(orderNo(order))}
        </div>
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ backgroundColor: C.page }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: "20px 10px" }}>
                <table
                  role="presentation"
                  width="600"
                  cellPadding={0}
                  cellSpacing={0}
                  dir={dir}
                  style={{
                    width: "100%",
                    maxWidth: 600,
                    backgroundColor: C.card,
                    borderRadius: 18,
                    overflow: "hidden",
                  }}
                >
                  <tbody>
                    {/* 1 · Brand header (one image — see the note above). */}
                    <tr>
                      <td align="center" style={{ padding: "18px 16px 6px" }}>
                        {siteBase ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`${siteBase}/brand/email-header.png`}
                            width={560}
                            alt={order.venue.name}
                            style={{
                              display: "block",
                              width: "100%",
                              maxWidth: 560,
                              height: "auto",
                              border: 0,
                            }}
                          />
                        ) : (
                          <p
                            style={{
                              fontFamily: FONT,
                              fontSize: 24,
                              fontWeight: 700,
                              color: C.green,
                              margin: 0,
                            }}
                          >
                            {order.venue.name}
                          </p>
                        )}
                      </td>
                    </tr>

                    {/* 2 · Thank you. */}
                    <tr>
                      <td style={{ padding: "8px 20px" }}>
                        <table
                          role="presentation"
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          style={{ backgroundColor: C.greenSoft, borderRadius: 16 }}
                        >
                          <tbody>
                            <tr>
                              <td align="center" style={{ padding: "22px 18px 24px" }}>
                                <table role="presentation" cellPadding={0} cellSpacing={0}>
                                  <tbody>
                                    <tr>
                                      <td
                                        align="center"
                                        width={60}
                                        height={60}
                                        style={{
                                          width: 60,
                                          height: 60,
                                          borderRadius: 30,
                                          backgroundColor: C.greenDark,
                                          color: "#ffffff",
                                          fontFamily: FONT,
                                          fontSize: 32,
                                          fontWeight: 700,
                                          lineHeight: "60px",
                                        }}
                                      >
                                        ✓
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                                <h1
                                  style={{
                                    fontFamily: FONT,
                                    fontSize: 36,
                                    lineHeight: "42px",
                                    color: C.greenDark,
                                    margin: "14px 0 6px",
                                  }}
                                >
                                  {t.thankYou}
                                </h1>
                                <p
                                  style={{
                                    fontFamily: FONT,
                                    fontSize: 19,
                                    fontWeight: 700,
                                    color: C.ink,
                                    margin: "0 0 6px",
                                  }}
                                >
                                  {t.received}
                                </p>
                                <p
                                  style={{
                                    fontFamily: FONT,
                                    fontSize: 15,
                                    color: C.ink,
                                    margin: 0,
                                  }}
                                >
                                  {t.preparing}
                                </p>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* 3 · The order. */}
                    <tr>
                      <td style={{ padding: "10px 20px" }}>
                        <table
                          role="presentation"
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          style={{
                            border: `1px solid ${C.line}`,
                            borderRadius: 14,
                            borderCollapse: "separate",
                          }}
                        >
                          <tbody>
                            <tr>
                              <td style={{ ...cell, textAlign: start, paddingTop: 16 }}>
                                <span style={{ color: C.muted, fontSize: 14 }}>
                                  {t.orderNumber}
                                </span>
                                <br />
                                <strong style={{ fontSize: 30, color: C.greenDark }}>
                                  #{orderNo(order)}
                                </strong>
                              </td>
                              <td
                                style={{
                                  ...cell,
                                  textAlign: end,
                                  color: C.muted,
                                  fontSize: 14,
                                  paddingTop: 16,
                                }}
                              >
                                {placed}
                                <br />
                                {placedTime}
                              </td>
                            </tr>
                            {whereLine ? (
                              <tr>
                                <td
                                  colSpan={2}
                                  style={{ ...cell, textAlign: start, paddingTop: 0, fontSize: 14 }}
                                >
                                  {whereLine}
                                </td>
                              </tr>
                            ) : null}
                            <tr>
                              <td colSpan={2} style={{ padding: "4px 10px" }}>
                                <table
                                  role="presentation"
                                  width="100%"
                                  cellPadding={0}
                                  cellSpacing={0}
                                >
                                  <tbody>
                                    <tr>
                                      <td
                                        style={{
                                          ...cell,
                                          textAlign: start,
                                          fontWeight: 700,
                                          backgroundColor: C.greenSoft,
                                          borderRadius: bandStart,
                                          color: C.greenDark,
                                        }}
                                      >
                                        {t.item}
                                      </td>
                                      <td
                                        style={{
                                          ...cell,
                                          textAlign: end,
                                          fontWeight: 700,
                                          backgroundColor: C.greenSoft,
                                          borderRadius: bandEnd,
                                          color: C.greenDark,
                                        }}
                                      >
                                        {t.price}
                                      </td>
                                    </tr>
                                    {order.items.map((item, i) => (
                                      <tr key={i}>
                                        <td style={{ ...cell, textAlign: start, fontWeight: 700 }}>
                                          {item.quantity} × {item.name}
                                        </td>
                                        <td
                                          style={{
                                            ...cell,
                                            textAlign: end,
                                            fontWeight: 700,
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {money(item.priceCents * item.quantity)}
                                        </td>
                                      </tr>
                                    ))}
                                    {order.discountCents > 0
                                      ? row(
                                          order.discountPoints > 0
                                            ? t.rewardPoints(String(order.discountPoints))
                                            : t.reward,
                                          `−${money(order.discountCents)}`,
                                        )
                                      : null}
                                    {order.giftCardDiscountCents > 0
                                      ? row(
                                          order.giftCardLast4
                                            ? t.giftCardCode(order.giftCardLast4)
                                            : t.giftCard,
                                          `−${money(order.giftCardDiscountCents)}`,
                                        )
                                      : null}
                                    {row(t.net, money(net), {
                                      borderTop: `1px solid ${C.line}`,
                                      color: C.muted,
                                    })}
                                    {row(t.vat, money(vat), { color: C.muted, paddingTop: 0 })}
                                    <tr>
                                      <td
                                        style={{
                                          ...cell,
                                          textAlign: start,
                                          fontSize: 24,
                                          fontWeight: 700,
                                          color: C.greenDark,
                                          backgroundColor: C.greenSoft,
                                          borderRadius: bandStart,
                                        }}
                                      >
                                        {t.total}
                                      </td>
                                      <td
                                        style={{
                                          ...cell,
                                          textAlign: end,
                                          fontSize: 24,
                                          fontWeight: 700,
                                          color: C.greenDark,
                                          backgroundColor: C.greenSoft,
                                          borderRadius: bandEnd,
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {money(order.totalCents)}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td colSpan={2} style={{ height: 10 }} />
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* 4 · How it is paid. */}
                    <tr>
                      <td style={{ padding: "6px 40px" }}>
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
                          <tbody>
                            <tr>
                              <td
                                align="center"
                                style={{
                                  fontFamily: FONT,
                                  fontSize: 16,
                                  fontWeight: 700,
                                  padding: "12px 14px",
                                  borderRadius: 12,
                                  backgroundColor: paid ? C.okBg : C.warnBg,
                                  color: paid ? C.okInk : C.warnInk,
                                }}
                              >
                                {paid ? "✅" : "💳"} {paymentLine}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* 5 · Receipt + tracking (+ the quiet review ask). */}
                    <tr>
                      <td align="center" style={{ padding: "12px 16px 4px" }}>
                        <LinkButton href={trackUrl} label={t.track} solid />
                        <LinkButton href={receiptUrl} label={t.pdf} />
                        {reviewUrl ? <LinkButton href={reviewUrl} label={t.rate} /> : null}
                      </td>
                    </tr>

                    {/* 6 · Three promises. */}
                    <tr>
                      <td style={{ padding: "14px 16px 18px" }}>
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
                          <tbody>
                            <tr>
                              {[
                                ["🌿", t.featFresh],
                                ["👨‍🍳", t.featAuthentic],
                                ["💚", t.featHospitality],
                              ].map(([icon, label], i) => (
                                <td
                                  key={i}
                                  align="center"
                                  width="33%"
                                  style={{
                                    fontFamily: FONT,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    letterSpacing: 0.5,
                                    textTransform: "uppercase",
                                    color: C.green,
                                    padding: "0 6px",
                                    // The divider sits between cells in either direction.
                                    [dir === "rtl" ? "borderRight" : "borderLeft"]:
                                      i > 0 ? `1px solid ${C.line}` : undefined,
                                  }}
                                >
                                  <span style={{ fontSize: 26 }}>{icon}</span>
                                  <br />
                                  {label}
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* 7 · Footer: where to find us. */}
                    <tr>
                      <td
                        style={{
                          backgroundColor: C.greenDark,
                          borderTop: `6px solid ${C.lime}`,
                          padding: "18px 16px 20px",
                        }}
                      >
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
                          <tbody>
                            <tr>
                              {footer.address ? (
                                <td
                                  style={{
                                    fontFamily: FONT,
                                    fontSize: 13,
                                    color: "#ffffff",
                                    padding: "4px 6px",
                                    verticalAlign: "top",
                                  }}
                                >
                                  📍{" "}
                                  {footer.address.split("\n").map((l, i) => (
                                    <span key={i}>
                                      {i > 0 ? <br /> : null}
                                      {l}
                                    </span>
                                  ))}
                                </td>
                              ) : null}
                              {footer.phone && footer.phoneHref ? (
                                <td
                                  style={{
                                    fontFamily: FONT,
                                    fontSize: 13,
                                    padding: "4px 6px",
                                    verticalAlign: "top",
                                  }}
                                >
                                  📞{" "}
                                  <a
                                    href={footer.phoneHref}
                                    dir="ltr"
                                    style={{
                                      color: "#ffffff",
                                      textDecoration: "none",
                                      unicodeBidi: "embed",
                                    }}
                                  >
                                    {footer.phone}
                                  </a>
                                </td>
                              ) : null}
                              {site ? (
                                <td
                                  style={{
                                    fontFamily: FONT,
                                    fontSize: 13,
                                    padding: "4px 6px",
                                    verticalAlign: "top",
                                  }}
                                >
                                  🌐{" "}
                                  <a
                                    href={siteBase}
                                    style={{ color: "#ffffff", textDecoration: "none" }}
                                  >
                                    {site}
                                  </a>
                                </td>
                              ) : null}
                            </tr>
                          </tbody>
                        </table>
                        <p
                          style={{
                            fontFamily: "Georgia, 'Times New Roman', serif",
                            fontStyle: "italic",
                            fontSize: 20,
                            color: "#ffffff",
                            textAlign: "center",
                            margin: "16px 0 4px",
                          }}
                        >
                          {t.tagline} ♡
                        </p>
                        <p
                          style={{
                            fontFamily: FONT,
                            fontSize: 11,
                            color: "#b9c9b9",
                            textAlign: "center",
                            margin: 0,
                          }}
                        >
                          {t.notInvoice} · {order.venue.name}
                        </p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
