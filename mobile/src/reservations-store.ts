import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Local reservation history — the same posture as `orders-store`.
 *
 * A table request needs no account, so the id + token the server hands
 * back when the request is filed ARE the guest's whole claim to it:
 * holding them on this device is what lets the app show "confirmed" or
 * "declined" later. Newest first, capped so the list can't grow
 * unbounded.
 */
export interface StoredReservation {
  id: string;
  /** Read credential for `GET /api/v1/reservations/{id}` — never a login. */
  token: string;
  /** "YYYY-MM-DD" · the venue's local day. */
  date: string;
  /** "HH:MM" · the venue's local time. */
  time: string;
  guests: number;
  name: string;
  /** ISO, minted on this device when the request was filed. */
  createdAt: string;
}

const KEY = "rangla-reservations-v1";
const MAX = 50;

export async function listStoredReservations(): Promise<StoredReservation[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredReservation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function rememberReservation(reservation: StoredReservation): Promise<void> {
  const existing = await listStoredReservations();
  const next = [reservation, ...existing.filter((r) => r.id !== reservation.id)].slice(0, MAX);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}
