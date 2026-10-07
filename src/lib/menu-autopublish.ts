import { revalidatePath } from "next/cache";
import { publishDraft } from "./menu-versions-service";

/**
 * Publish the draft right after a dashboard menu edit (owner, 2026-10-07:
 * "we don't want to publish every time — saving should make it live, like
 * any change from the app"). The restaurant app already writes both the
 * draft and the live copy; this brings the dashboard to the same rule.
 *
 * Never throws and never blocks the save: an empty draft (nothing to
 * publish yet) or a hiccup leaves the change saved in the draft, and the
 * sidebar's Publish button still exists as the manual way out.
 */
export async function publishAfterEdit(userId: string): Promise<void> {
  try {
    const result = await publishDraft(userId);
    if (!result.ok) return;
    const { purgeMenuForUser } = await import("./cdn-purge");
    await purgeMenuForUser(userId);
    revalidatePath("/dashboard", "layout");
  } catch {
    // The edit itself is saved; publishing can be retried by hand.
  }
}
