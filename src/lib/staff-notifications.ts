import type { StaffPrincipal } from "./staff-auth";
import { asTenant } from "./tenant";

/**
 * The restaurant app's bell (owner, 2026-10-14): the notifications this
 * login may see — the owner all of them, a team member those for its
 * boxes (orders / reservations / catering) — newest first, and how many
 * arrived since the bell was last opened.
 */

const WINDOW_DAYS = 30;
const LIMIT = 100;

export interface StaffNotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, string>;
  createdAt: string;
  unseen: boolean;
}

function visibleNeeds(staff: StaffPrincipal): string[] | null {
  if (staff.isOwner) return null;
  return ["orders", "reservations", "catering"].filter((n) =>
    (staff.permissions as string[]).includes(n),
  );
}

export async function staffNotifications(
  staff: StaffPrincipal,
): Promise<{ unread: number; items: StaffNotificationView[] }> {
  const needs = visibleNeeds(staff);
  if (needs && needs.length === 0) return { unread: 0, items: [] };
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  return asTenant(staff.tenantId, async (tx) => {
    const seen = await tx.staffNotificationSeen.findUnique({
      where: { tenantId_userId: { tenantId: staff.tenantId, userId: staff.userId } },
      select: { seenAt: true },
    });
    const where = {
      createdAt: { gte: since },
      ...(needs ? { need: { in: needs } } : {}),
    };
    const [rows, unread] = await Promise.all([
      tx.staffNotification.findMany({ where, orderBy: { createdAt: "desc" }, take: LIMIT }),
      tx.staffNotification.count({
        where: { ...where, ...(seen ? { createdAt: { gt: seen.seenAt, gte: since } } : {}) },
      }),
    ]);
    return {
      unread,
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        data: (r.data ?? {}) as Record<string, string>,
        createdAt: r.createdAt.toISOString(),
        unseen: !seen || r.createdAt > seen.seenAt,
      })),
    };
  });
}

/** Opening the bell marks everything up to now as seen, for this login. */
export async function markStaffNotificationsSeen(staff: StaffPrincipal): Promise<void> {
  const now = new Date();
  await asTenant(staff.tenantId, (tx) =>
    tx.staffNotificationSeen.upsert({
      where: { tenantId_userId: { tenantId: staff.tenantId, userId: staff.userId } },
      create: { tenantId: staff.tenantId, userId: staff.userId, seenAt: now },
      update: { seenAt: now },
    }),
  );
}
