# Payment safety — authorize, check, then capture

Reference implementation: **rangla-punjab-resturant** (live since 2026-10-21, commits
`deec592` … `d8d5ea5`). Written so the same guarantees can be ported to **elvoria-food**
(multi-tenant SaaS, Stripe Connect + PayPal + Mollie, payment requests).

---

## 1. Why — the incident (order O-6, 2026-10-19)

1. Guest opened the Stripe card page, then switched to PayPal (twice).
2. Stripe sent `checkout.session.completed` for the **old** card page; our webhook rejected it
   (signing-secret mismatch).
3. A day later Stripe's retry got through → the order was marked **paid** and appeared on the
   kitchen board. The guest had **not paid**: the old code trusted "session completed" and never
   asked Stripe whether money was taken.
4. The owner reset it; a manual **"Resend"** in Stripe marked it paid **again**.

Root problems: (a) "paid" derived from an event, not from the money; (b) no record of what each
attempt asked for; (c) old payment pages stayed payable; (d) webhook not idempotent; (e) no
durable reconciliation; (f) late events treated like fresh ones.

## 2. The guarantees (acceptance criteria)

| # | Guarantee |
|---|---|
| G1 | An order becomes **paid only when the provider confirms money moved** — either our own capture succeeded, or the provider reports it paid — never from a page/event alone. |
| G2 | The paid **amount + currency equal** the immutable amount stored for that payment attempt. |
| G3 | **Money is only taken after every check passes** (authorize → check → capture). A failed check **releases** the reservation: the guest is never charged, no manual refund. |
| G4 | Two attempts (Stripe + PayPal, card twice, two devices) can **never both** be taken for one order. |
| G5 | Webhooks are **transactional, retry-safe, idempotent**: a duplicate/resend is a no-op; a failed processing stays retryable. |
| G6 | **Durable**: a crash between "provider took the money" and "we recorded it" is found and finished automatically. |
| G7 | The time rule is judged on **when the guest authorized**, not when we processed (server downtime must not discard a valid payment). |
| G8 | Cancelled / deleted orders are **never recreated or re-paid** by late events. |
| G9 | Live keys never used outside production. |

## 3. Data model

### `payment_attempts` (new)
One row per provider payment we start (Stripe Checkout Session / PaymentIntent, PayPal order,
Mollie payment…). Written **in the same transaction** that points the order at it.

| column | notes |
|---|---|
| `id`, `tenant_id`, `venue_id`, `order_id` | `order_id` **no FK** — the attempt outlives a deleted order |
| `order_label` | e.g. `O-6`, for logs/alerts after deletion |
| `provider`, `ref` | unique `(provider, ref)`; ref = `cs_…`/`pi_…`/PayPal order id |
| `amount_cents`, `currency` | what the guest was asked for — **immutable** |
| `status` | `open · capturing · succeeded · failed · expired · cancelled` |
| `settled` | true for the one attempt that paid the order |
| `authorized_at` | provider's authorization time (G7) |
| `capture_started_at` | set with `capturing` (G6) |
| `resolution`, `resolution_reason`, `resolution_note`, `resolved_by/at` | only for money taken without us that the order can't accept |
| `succeeded_at`, `created_at`, `updated_at` | |

DB-level guarantees:
- **Immutability trigger**: `BEFORE UPDATE` raises if `amount_cents, currency, ref, provider,
  order_id, tenant_id` change.
- CHECKs on `provider`, `status`, `resolution`, `amount_cents >= 0`.
- `tenant_id` + **FORCE RLS** + `tenant_isolation` policy (like every tenant table) + CI
  cross-tenant test.
- Backfill existing online orders (see §8 — the RLS pitfall).

### `webhook_events` (existing, extended)
Add `status ('processing'|'done')`, `claimed_at`. Global (no tenant) by design.

## 4. Flow

```
START PAYMENT (guest, token-authorized)
  ├─ releaseSuperseded(order): current Stripe attempt?
  │     reserved/paid meanwhile → settle it, refuse the new start ("already_paid")
  │     open page               → expire session / cancel intent, attempt = cancelled
  │     processing              → refuse ("processing")
  └─ create provider payment (Stripe: capture_method=manual, Checkout expires_at=+30 min)
     + payment_attempts row (amount, currency) + order.paymentRef = ref   [one transaction]

GUEST PAYS → card reserved / PayPal approved (nothing taken)

TRIGGER (webhook | pay-page return | app verify | reconciler)  — the event is only a trigger
  └─ processPayment(ref): ask the PROVIDER for the current state
        requires_capture / APPROVED → settle(stage=authorized)
        succeeded / COMPLETED       → settle(stage=captured)   (taken without us)
        expired / canceled / VOIDED → close attempt; order failed if it was waiting on it
        otherwise                   → not ready, do nothing

SETTLE — three steps (payment-settlement.ts)
  1. DECIDE  [tx: tenant GUC + pg_advisory_xact_lock(hash('pay:'+orderId)) + SELECT … FOR UPDATE on order]
       attempt found? (or adopt: order.paymentRef == ref → create attempt from order)
       already succeeded → no-op · capturing → "in progress"
       checks: metadata orderId == attempt.orderId
               amount+currency == attempt (exact)
               order exists, not cancelled, unpaid (pending|failed), still online
               order total == attempt amount (unchanged)
               no OTHER attempt of the order capturing or settled
               attempt status open; for authorized: attempt is the order's CURRENT payment
               authorizedAt - attempt.createdAt <= 45 min
       pass + authorized → attempt.status = capturing, capture_started_at = now  → COMMIT
       pass + captured   → settle now (step 3 logic)
       fail + authorized → release (step 2b)
       fail + captured   → resolution = needed (order untouched), log
  2. CAPTURE at provider — NO DB transaction open (never hold a lock across HTTP)
       Stripe: paymentIntents.capture(pi, {}, {idempotencyKey: 'capture-'+pi})
       PayPal: POST /v2/checkout/orders/{id}/capture (ORDER_ALREADY_CAPTURED → GET order)
  2b. RELEASE: Stripe cancel intent / expire session; PayPal: nothing (approval lapses)
       → attempt cancelled, order failed (if waiting on it), log "Not charged — <reason>"
  3. RECORD  [tx + lock]
       not captured            → attempt failed, order failed, log
       captured, amount differs → resolution needed
       captured, order no longer accepts (cancelled meanwhile…) → resolution needed
       else → attempt succeeded+settled; order paid, paidAt=now,
              paymentProvider/paymentRef = this attempt; order event
  after commit: receipt mail, new-order push/notification, loyalty, payment-method lookup

RECONCILER (in-process timer every 2 min + at boot)
  open attempts (last 8 days) + all "capturing" (stale > 2 min)
  → processPayment(ref) — same code path; stale capturing: provider says taken → record;
    still reserved → capture again (idempotent); else → failed
```

## 5. Webhooks (G5)

`processWebhookOnce(eventId, provider, work)`:
1. `INSERT … ON CONFLICT DO NOTHING` with `status='processing'`.
2. Exists & `done` → **200 replayed**. Exists & `processing` & fresh → **409** (provider retries).
   `processing` & older than 5 min → take over (crashed run).
3. `work()` succeeds → `status='done'`. Throws → **delete the claim**, rethrow → **5xx** →
   provider retries.

Rules:
- Verify the signature first (Stripe HMAC with the endpoint's `whsec`; PayPal
  verify-webhook-signature API with the registered webhook id).
- **Never trust event payload** for amount/status — re-read from the provider.
- One dispatcher for all endpoints (Rangla had two Stripe routes; the "own" route lacked
  idempotency and gift-card handling).
- Events to subscribe (Stripe): `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
  `checkout.session.expired`, `payment_intent.succeeded`,
  `payment_intent.amount_capturable_updated`, `payment_intent.payment_failed`,
  `payment_intent.canceled`.
- `payment_intent.payment_failed` is **not final** (guest may try another card on the same
  page): mark the order failed only if it is the current attempt; keep the attempt open.

## 6. Provider specifics

### Stripe
- Checkout: `payment_intent_data: { capture_method: "manual" }`, `expires_at = now + 30 min
  (+60 s slack — Stripe rejects < 30 min by its clock)`, session `metadata: {orderId, tenantId}`.
- **Do NOT put `orderId` metadata on the Checkout PaymentIntent** (§9, bug #3).
- App/native PaymentIntent: `capture_method: manual` for orders; gift cards stay automatic.
- Reading a session: expand `payment_intent.latest_charge`; status mapping:
  `payment_status=paid → succeeded`, PI `requires_capture → requires_capture`,
  `expired / PI canceled → canceled`, `complete (unpaid) → processing`.
- `authorizedAt` = `latest_charge.created`.
- Hold life: **7 days** (cards). Methods without manual capture are hidden by Checkout
  automatically — check the dashboard's payment methods.

### PayPal
- `intent: CAPTURE`; approval = authorization; **we** capture.
- `getOrderState(ref)` → `status` (CREATED/APPROVED/COMPLETED/VOIDED), `approvedAt`
  (`update_time` when APPROVED), captured amount from `purchase_units[0].payments.captures[]`.
- Amount in cents from the decimal string exactly (`"134.60" → 13460`).
- One PayPal order per attempt (unique ref).

### Mollie (elvoria-food only — not in Rangla)
- Use `captureMode: "manual"` where supported (cards, some BNPL); otherwise those methods
  can't follow G3 — decide per method (exclude, or treat as "captured" stage).
- Map Mollie statuses to the same states (`authorized → requires_capture`, `paid → succeeded`,
  `expired/canceled/failed → closed`).

## 7. Time rules

| Constant | Value | Why |
|---|---|---|
| Checkout expiry | 30 min | Stripe minimum; old tabs can't pay later |
| Auto-accept window | 45 min from attempt start, **judged on authorization time** | page life + webhook slack; downtime doesn't discard valid payments |
| Stale capture | 2 min | a real capture takes seconds |
| Reconcile lookback | 8 days | card holds last 7 |
| Reconcile interval | 2 min + at boot | |

## 8. Migration pitfalls (production broke on this)

- Production migrates as the **table owner, not a superuser**. With **FORCE RLS** the owner
  obeys policies; a migration has **no tenant GUC** → reads return 0 rows, inserts are refused
  (`42501 new row violates row-level security policy`).
- Locally the DB user was a **superuser** → everything passed. **Always test migrations on a
  scratch DB owned by a NOSUPERUSER NOBYPASSRLS role**, with pre-existing data seeded.
- Backfill order: create table → **backfill** (lift `FORCE` on the source table only if it was
  forced, restore exactly) → **then** enable/force RLS + policy.
- A failed migration leaves a failed row in `_prisma_migrations` → every deploy fails `P3009`
  until `prisma migrate resolve --rolled-back <name>`. Prisma rolled the SQL back atomically.
- Cross-tenant background reads: a `SECURITY DEFINER` function owned by the same
  non-superuser owner **still** obeys FORCE RLS. Use a dedicated mechanism (see §10).
- `instrumentation.ts` is also compiled for the **Edge runtime**: import the timer **inside**
  `if (process.env.NEXT_RUNTIME === "nodejs")`, or `node:crypto` breaks `next build`.

## 9. Bugs we hit (test for each)

1. **Paid without money** (O-6) — trusted `checkout.session.completed`. → Only provider-confirmed money.
2. **Deploy failed** — backfill under FORCE RLS as non-superuser. → §8.
3. **Every web card payment cancelled** (O-11) — Checkout PI carried `orderId` metadata;
   `payment_intent.amount_capturable_updated` (~150 ms before `checkout.session.completed`)
   was processed under the `pi_` ref, matched no attempt (attempts keyed by `cs_`), and the
   "unknown attempt" path **released** it. → (a) no orderId metadata on Checkout PIs;
   (b) **never cancel an unmatched reservation** (Stripe releases it after 7 days).
   Regression test sends the PI event first, then the session event.
4. Gift cards never activated via the "own" webhook route — separate dispatcher. → one dispatcher.
5. Verify/reconcile only understood `pi_` refs, not `cs_` → the safety net never worked for web.

## 10. Porting to elvoria-food — what must differ

| Topic | Rangla (single restaurant) | elvoria-food (SaaS) |
|---|---|---|
| Tenant for background jobs | resolve THE restaurant: `RESTAURANT_SLUG` → `resolve_public_venue` → `asTenant` | iterate **all tenants**: needs a sanctioned cross-tenant read (e.g. a dedicated reconciler role with BYPASSRLS, or a superuser-owned SECURITY DEFINER function — verify it works for the prod connection role) and then per-tenant `asTenant` |
| Stripe account | restaurant's own keys / deployment keys (direct charges) | **Connect**: create + capture + cancel **on the connected account** (`stripeAccount` header or destination charges); `application_fee_amount` on capture; webhook from **Connect endpoint** (`account` field) with its own secret |
| Webhook secrets | one endpoint | platform endpoint + Connect endpoint; per-tenant own keys if supported |
| Providers | Stripe, PayPal | + **Mollie** (§6), payment requests |
| Owner tooling | `deploy.sh payments` | per-tenant view in the merchant dashboard / platform admin |
| Existing code | — | already has `payment-reconcile.ts`, `payment-provider.ts`, `payment-timing.ts`: extend these rather than add parallel paths |

Order of work for elvoria-food (each step green before the next):
1. `payment_attempts` + immutability trigger + RLS + backfill migration (tested as non-superuser).
2. Write an attempt at every payment start (all providers, payment requests too).
3. Claimed, retry-safe webhook processing for every provider endpoint.
4. One settlement module (decide/capture/record) + adapter per provider (`getState`, `capture`, `release`, `authorizedAt`).
5. Switch Stripe (Connect-aware) and Mollie to manual capture; Checkout 30-min expiry.
6. Release superseded attempts on method switch / delete / cancel.
7. Reconciler covering `open` + `capturing`, multi-tenant.
8. Pay-page success return verifies synchronously.
9. Live-key guard outside production.
10. Tests (§11), staging/local E2E with **test keys only**, then deploy at a quiet time.

## 11. Test matrix (Rangla: `src/lib/payment-safety.test.ts`, 37 scenarios)

Reserved-then-captured · amount immutable (trigger) · duplicate webhook / resend / second event
for the same payment · failed processing stays retryable · parallel delivery → 409 · crashed
claim taken over · webhooks down inside window → sweep captures · server down for hours but
authorized in time → captured · authorized after window → released · O-6 replay · old
auto-capture page taken late → resolution needed · crash after capture / before capture →
reconciler finishes · fresh `capturing` not double-captured · two paths racing → one capture ·
expired page (sweep + `checkout.session.expired`) · order total changed → not charged · capture
amount differs → resolution · switch card→PayPal closes card page · reserved meanwhile → switch
captures and refuses PayPal · concurrent Stripe + PayPal → exactly one · PayPal approved late /
in time but processed late / captured-at-PayPal-unrecorded · cancelled order releases ·
delete releases + no recreate + bell cleaned · delayed method unpaid → waits / fails / succeeds ·
decline on older attempt doesn't fail current · unknown reservation left alone · **PI event before
session event (bug #3)** · single-restaurant resolution / unknown slug / production-role isolation.

Mutation-check the critical ones (remove the advisory lock; judge time on processing time;
skip the `capturing` state; restore the release-unknown path) — each must make a test fail.

## 12. Operations

- `./deploy/deploy.sh payments` — lists *needs action* (money taken, not accepted), *capturing*,
  *open > 1 h*; `RESOLVE=<id> NOTE="refunded in Stripe"` marks one handled.
- Order log entries: `payment.paid`, `payment.superseded_paid`, `payment.not_captured`,
  `payment.failed`, `payment.needs_resolution`, `payment.resolved`.
- Testing: **only locally** with `sk_test_…` / PayPal sandbox in `.env.local` (gitignored);
  live keys are refused outside `NODE_ENV=production`.

## 13. Reference files (Rangla)

| File | Role |
|---|---|
| `src/lib/payment-settlement.ts` | decide → capture → record; lock; attempts; release |
| `src/lib/payment-windows.ts` | 30 / 45 min constants, `expires_at` helper |
| `src/lib/connect-service.ts` | `processStripeOrderPayment`, `releaseSupersededStripePayment`, verify, dashboard sweep, start payment + attempt |
| `src/lib/paypal-service.ts` | `processPayPalOrderPayment`, `finalizePayPalReturn`, start + attempt |
| `src/lib/stripe/webhook-handler.ts`, `src/lib/paypal-webhook-handler.ts` | dispatch (event = trigger) |
| `src/lib/webhook-claims.ts` | retry-safe idempotency |
| `src/lib/payment-reconcile.ts`, `src/lib/payment-reconciler-timer.ts` | durable sweep |
| `src/lib/stripe/real-provider.ts`, `src/lib/paypal.ts` | manual capture, capture/cancel, state + authorizedAt |
| `src/lib/live-key-guard.ts` | live keys only in production |
| `prisma/migrations/20261021120000…`, `…130000…`, `…140000…` | schema, backfill, capture state |
| `scripts/payments-report.ts` | owner report |
| `src/lib/payment-safety.test.ts` | scenario tests |
