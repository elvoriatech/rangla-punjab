import { Platform } from "react-native";
import * as Print from "expo-print";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchStaffTicketHtml } from "./staff";

/**
 * Kitchen tickets, printed from the phone or tablet on the pass.
 *
 * The app renders NOTHING: the server sends one self-contained HTML
 * document per order and this module hands it to whatever print stack
 * the platform has — AirPrint on iOS, the Android print framework on
 * Android, the browser's own dialog on web. That is deliberate. A venue
 * that wants a different ticket layout changes it server-side; no app
 * release, no store review, and every device prints the same paper.
 *
 * Nothing here ever throws or blocks the board. A printer that is off,
 * a network that dropped, an owner who tapped Cancel in the print sheet
 * — each comes back as an outcome the caller can say one line about.
 */

export type PrintOutcome =
  | "ok"
  /** The owner dismissed the platform's print sheet. Not a failure, and
   *  must not be reported as one. */
  | "cancelled"
  /** The staff session is gone — the caller signs restaurant mode out. */
  | "unauthorized"
  | "notfound"
  | "network"
  /** The document arrived but the platform refused to print it. */
  | "failed";

/**
 * iOS rejects a dismissed print sheet rather than resolving, and Android
 * does the same when the user backs out of the print preview. Neither is
 * an error worth a red line on the board, so they are told apart from a
 * real failure by the message the platform gives.
 */
function isCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /cancel|did not complete|dismiss/i.test(message);
}

/**
 * Web has no `printAsync({ html })` worth the name: expo-print there
 * prints the CURRENT page, which would put the owner's board on paper
 * instead of the ticket. So the document goes into its own window, which
 * prints itself once it has laid out and closes behind the dialog.
 */
function printInBrowser(html: string): PrintOutcome {
  // A pop-up blocker is the normal failure here, and it is silent.
  const win = window.open("", "_blank", "width=420,height=640");
  if (!win) return "failed";
  win.document.open();
  win.document.write(html);
  win.document.close();
  // NOT `win.onload`: for a document written synchronously into an
  // about:blank window the load event may already have fired by the
  // time the handler is attached, and the window would then sit there
  // having printed nothing. A frame's delay after `close()` is enough
  // for layout — the ticket is self-contained, so there are no external
  // assets still in flight — and `onafterprint` tidies up where the
  // browser supports it.
  win.onafterprint = () => win.close();
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      // The operator closed the window before it printed. Nothing to
      // recover, and nothing worth an error line for.
    }
  }, 250);
  return "ok";
}

/** Fetch one order's ticket and put it in front of a printer. */
export async function printTicket(staffToken: string, orderId: string): Promise<PrintOutcome> {
  const res = await fetchStaffTicketHtml(staffToken, orderId);
  if (!res.ok) {
    if (res.error === "unauthorized") return "unauthorized";
    if (res.error === "notfound") return "notfound";
    if (res.error === "network") return "network";
    return "failed";
  }
  if (Platform.OS === "web") return printInBrowser(res.data);
  try {
    await Print.printAsync({ html: res.data });
    return "ok";
  } catch (error) {
    return isCancellation(error) ? "cancelled" : "failed";
  }
}

/* ------------------------------------------------------------------ *
 * Auto-print.
 *
 * "Every new order prints itself" is only useful if it means EXACTLY
 * once. Two things would break that, and both are handled here rather
 * than on the board:
 *
 *  - A restart. The board's new-order detection is per session (its
 *    `seen` set starts empty), so without a persisted record a relaunch
 *    mid-service would treat the whole open board as new and spool a
 *    dozen duplicate tickets.
 *  - Turning the switch ON during service. The orders already on the
 *    board are not news; they are baselined instead of printed.
 *
 * The record is a capped ring of ids in AsyncStorage — small, and it
 * survives exactly as long as it needs to.
 * ------------------------------------------------------------------ */

const ENABLED_KEY = "rangla-auto-print";
const PRINTED_KEY = "rangla-auto-print-ids";
/** Roughly a very busy day's tickets. Oldest fall off first. */
const MAX_PRINTED = 200;

/** Default OFF: a device must never start printing on its own because
 *  someone signed in on it. */
export async function isAutoPrintOn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ENABLED_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setAutoPrintOn(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  } catch {
    // A device that cannot persist the switch still honours it for this
    // session — the in-memory state is the board's, not ours.
  }
}

async function readPrinted(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(PRINTED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function writePrinted(ids: readonly string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PRINTED_KEY, JSON.stringify(ids.slice(0, MAX_PRINTED)));
  } catch {
    // Storage full or unavailable: the worst case is one duplicate
    // ticket after a restart, which is better than not printing.
  }
}

/**
 * Record ids as already dealt with WITHOUT printing them — what happens
 * the first time the switch goes on, so the backlog on the board stays
 * on the board.
 */
export async function baselinePrinted(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const known = await readPrinted();
  const seen = new Set(known);
  const added = ids.filter((id) => !seen.has(id));
  if (added.length === 0) return;
  await writePrinted([...added, ...known]);
}

/**
 * Claim the ids that have not been printed before, marking them printed
 * in the same step.
 *
 * Marked BEFORE the paper comes out on purpose: a ticket that failed to
 * print is a line on the board the owner can act on, whereas one that
 * printed twice because the claim happened afterwards is two plates of
 * the same food.
 */
export async function claimUnprinted(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const known = await readPrinted();
  const seen = new Set(known);
  const fresh = ids.filter((id) => !seen.has(id));
  if (fresh.length === 0) return [];
  await writePrinted([...fresh, ...known]);
  return fresh;
}
