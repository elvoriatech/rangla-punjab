import { Prisma } from "@prisma/client";
import { asTenant } from "./tenant";
import { TERMINAL_STATUSES } from "./order-status";
import { createLogger } from "./logger";

const log = createLogger();

/**
 * "Konto löschen" — the guest erases their own account (GDPR Art. 17,
 * and Google Play / App Store's in-app deletion requirement).
 *
 * The row is ANONYMISED, not dropped. A hard `DELETE` would cascade the
 * gift cards this guest bought — paid money, a bearer instrument the
 * recipient may still be holding — so the row stays as an empty husk
 * that owns them, and everything that identified a person is wiped:
 *
 *   - profile: email, name, phone, delivery address, password, language;
 *   - identity: provider/sub are rewritten, so signing in with the same
 *     Google account (or registering the same email) later starts a
 *     FRESH account instead of reviving this one — the upserts in
 *     customer-auth.ts would otherwise clear `deletedAt` and hand the
 *     old row back;
 *   - sessions + password-reset tokens: gone, every device signed out;
 *   - loyalty: points and unused rewards lapse with the account;
 *   - orders: unlinked. FINISHED orders also lose the guest's contact
 *     details — the sale itself stays, because German tax law (AO/GoBD)
 *     keeps sales records for ten years. An order still in progress
 *     keeps them: the kitchen has to deliver it and may have to ring;
 *   - reservations + complaint threads: unlinked (the restaurant's own
 *     book and its record of a handled complaint are not the guest's);
 *   - gift cards bought: the buyer's phone is cleared; the card itself
 *     and its code keep working.
 *
 * All in one transaction: a half-deleted account is worse than either end.
 * Returns false when there was nothing live to delete.
 */
export async function deleteCustomerAccount(
  tenantId: string,
  customerId: string,
): Promise<boolean> {
  const deleted = await asTenant(tenantId, async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) return false;

    await tx.order.updateMany({
      where: { customerId, status: { in: [...TERMINAL_STATUSES] } },
      data: {
        customerId: null,
        customerName: null,
        customerPhone: null,
        customerEmail: null,
        deliveryAddress: Prisma.DbNull,
      },
    });
    await tx.order.updateMany({ where: { customerId }, data: { customerId: null } });
    await tx.reservation.updateMany({ where: { customerId }, data: { customerId: null } });
    await tx.orderIssue.updateMany({ where: { customerId }, data: { customerId: null } });
    await tx.giftCard.updateMany({
      where: { purchaserCustomerId: customerId },
      data: { purchaserPhone: null },
    });

    await tx.loyaltyLedger.deleteMany({ where: { customerId } });
    await tx.loyaltyVoucher.deleteMany({ where: { customerId } });
    await tx.customerToken.deleteMany({ where: { customerId } });
    await tx.customerPasswordResetToken.deleteMany({ where: { customerId } });

    await tx.customer.update({
      where: { id: customerId },
      data: {
        provider: "deleted",
        providerSub: customerId,
        // Empty rather than a placeholder address: the gift-card mailer
        // skips a purchaser without an email, so nothing is ever sent to
        // an account that no longer exists.
        email: "",
        name: null,
        phone: null,
        lastDeliveryAddress: Prisma.DbNull,
        passwordHash: null,
        locale: null,
        reviewClickedAt: null,
        deletedAt: new Date(),
      },
    });
    return true;
  });
  if (deleted) log.info("customer_auth.account_deleted", { customerId });
  return deleted;
}
