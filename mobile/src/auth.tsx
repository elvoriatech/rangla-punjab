import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, Platform } from "react-native";
import * as ExpoLinking from "expo-linking";
import { BASE_URL } from "./api";
import { openReturningPage } from "./browser";
import { useI18n } from "./i18n";
import { unregisterStaffPush } from "./push";
import { staffLogout } from "./staff";
import {
  clearStaffToken,
  clearToken,
  readStaffToken,
  readToken,
  writeStaffToken,
  writeToken,
} from "./token-store";

/**
 * Sign-in for the app.
 *
 * Two routes to the same opaque customer token:
 *
 *  1. **Native Google one-tap** (`loginWithGoogle`) — the Google SDK
 *     returns an ID token, the backend verifies it against Google's JWKS
 *     and upserts the customer. Registration is implicit: the first
 *     sign-in creates the account. Needs the EXPO_PUBLIC_GOOGLE_*_CLIENT_ID
 *     build vars AND a native build (the module does not exist in Expo Go).
 *  2. **Device-code browser flow** (`login`) — the app mints a device
 *     code, opens the provider login in an in-app browser and polls
 *     until the backend parks the token under that code. No native
 *     module, works everywhere; the fallback whenever (1) is unavailable.
 *     The device code carries our `auth-return` deep link, so the last
 *     page of the flow hands the browser straight back to the app
 *     instead of leaving the guest on the website.
 *
 * Plus email/password against the app's own account endpoints, and the
 * **forgotten-password** round trip (P7-15): the app asks the server to
 * mail a link, the guest sets the new password on the web page that link
 * opens, and that page hands the browser back to `APP_RETURN_URL`. The
 * app watches for exactly that return (see `RESET_STATUS` below) because
 * the reset revokes every live token of that customer — so the session
 * this device is holding, if any, is already dead.
 *
 * **Restaurant mode.** The owner signs in through the SAME email/password
 * form the guests use — there is no separate screen, and a signed-out app
 * gives no hint that one exists. The server decides: it answers the login
 * with `kind: "restaurant"` and a staff token instead of a customer one,
 * and the app then shows the orders board. The two sessions are mutually
 * exclusive by construction (a device is a guest's phone OR the counter
 * tablet, never both), and the staff token lives in its own secure-store
 * slot so neither sign-out can strand the other.
 */

/**
 * Where a web page that the app sent the guest out to is meant to land
 * them again. The path is shared with the browser sign-in flow; what
 * distinguishes one trip from another is the query the app itself puts
 * on the URL, which the web side carries back untouched (it treats the
 * whole thing as one opaque allow-listed deep link).
 */
export function appReturnUrl(status?: string): string {
  return ExpoLinking.createURL("auth-return", status ? { queryParams: { status } } : undefined);
}

/** The `?status=` value that means "this guest just changed their
 *  password on the web". */
export const RESET_STATUS = "reset";

export interface DeliveryAddress {
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  note?: string | null;
}
export interface CustomerProfile {
  id?: string;
  email: string;
  name: string | null;
  /** Wired by the profile endpoints; older servers omit both. */
  phone?: string | null;
  lastDeliveryAddress?: DeliveryAddress | null;
  /** The guest's UI language, on the ACCOUNT rather than the handset, so
   *  it follows them to a second device and survives a reinstall. Absent
   *  on a server that predates the column; null when never chosen. */
  locale?: string | null;
}
export interface AccountOrder {
  orderId: string;
  orderNumber: number;
  status: string;
  orderType: string;
  paymentStatus: string;
  totalCents: number;
  currency: string;
  placedAt: string;
  receiptToken: string;
}

/** The restaurant behind a staff session. Name + email only: everything
 *  else the board needs comes from the staff routes. */
export interface StaffProfile {
  name: string;
  email: string;
}

/** Why a Google sign-in didn't produce a session. "unavailable" is the
 *  only one the UI treats as "use the browser flow instead". */
export type GoogleOutcome = "unavailable" | "cancelled" | "failed" | null;

/** `busyProvider` while the NATIVE Google sheet is up. Distinct from
 *  "google" (the browser device flow) because only the latter means
 *  "we're waiting on another app to come back". */
export const GOOGLE_NATIVE = "google-native";

interface AuthApi {
  token: string | null;
  customer: CustomerProfile | null;
  /** False until the secure-store reads that restore a saved session have
   *  BOTH settled. Until then `token`/`staff` being null means "we haven't
   *  looked yet", not "signed out" — the shell waits on this before it
   *  decides whether to show the welcome screen (a device that is already
   *  signed in must never see it flash past). */
  ready: boolean;
  /** Non-null ⇔ this device is signed in as the RESTAURANT. The whole of
   *  restaurant mode hangs off this one value. */
  staff: StaffProfile | null;
  /** Bearer for `X-Staff-Token`; null whenever `staff` is. */
  staffToken: string | null;
  /** Ends the restaurant session: tells the server (failures ignored —
   *  the token is useless to this device either way) and drops the key. */
  logoutStaff: () => Promise<void>;
  /** A staff route answered 401: the session is already gone server-side,
   *  so drop it locally without another round trip. */
  clearStaff: () => void;
  /** Swap the staff credential for a re-issued one WITHOUT re-signing in.
   *  Changing the password invalidates every token minted before it, so
   *  `POST /api/v1/staff/password` hands back a fresh one; adopting it is
   *  what keeps the device that made the change signed in. The profile
   *  (name, email) is unchanged — it is the same account. */
  replaceStaffToken: (next: string) => Promise<void>;
  busyProvider: string | null;
  providers: { id: string; label: string }[];
  /** Is there ANY route to a Google account from this build — the native
   *  SDK (client ids present, module linked) or a server-side Google
   *  provider in the browser device flow? False means: don't offer the
   *  button, it would dead-end. */
  googleAvailable: boolean;
  refreshProviders: () => Promise<void>;
  login: (providerId: string) => Promise<boolean>;
  /** Native one-tap. Falls back to the device-code browser flow itself
   *  when the native module or the client ids are missing. */
  loginWithGoogle: () => Promise<GoogleOutcome>;
  /** Email/password sign-in or sign-up against the app's own account
   *  endpoints. Returns null on success, or an error key for the UI. */
  loginWithEmail: (
    mode: "login" | "register",
    email: string,
    password: string,
    name?: string,
  ) => Promise<"invalid" | "exists" | "failed" | null>;
  cancelLogin: () => void;
  logout: () => Promise<void>;
  fetchMyOrders: () => Promise<AccountOrder[]>;
  /** Remember the guest's language on their ACCOUNT, so it follows them
   *  to their next device. No-op when signed out. */
  saveLocale: (locale: string) => void;
}

const AuthContext = createContext<AuthApi | null>(null);

// Baked at build time (expo convention). Absent in dev and in any build
// made before the Google Cloud OAuth clients existed — that is the
// supported state, not an error: the app keeps the browser flow.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

/** Android reads its client id from the SHA-1 registered in Google Cloud
 *  and only needs the WEB id; iOS needs its own. */
const googleConfigured =
  Platform.OS === "ios"
    ? Boolean(GOOGLE_IOS_CLIENT_ID)
    : Platform.OS === "android"
      ? Boolean(GOOGLE_WEB_CLIENT_ID || GOOGLE_ANDROID_CLIENT_ID)
      : false;

type GoogleModule = {
  GoogleSignin: {
    configure: (options: Record<string, unknown>) => void;
    hasPlayServices: (options?: { showPlayServicesUpdateDialog: boolean }) => Promise<boolean>;
    signIn: () => Promise<{ type: string; data?: { idToken: string | null } | null }>;
    signOut: () => Promise<unknown>;
  };
};

/** Required lazily and defensively: in Expo Go the native module is not
 *  linked and touching it throws. A throw here just means "no one-tap". */
function loadGoogle(): GoogleModule | null {
  if (!googleConfigured) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@react-native-google-signin/google-signin") as GoogleModule;
  } catch {
    return null;
  }
}

/**
 * What goes in the staff secure-store slot: the token plus the two
 * display fields, so the header card is right the instant the app opens
 * (and stays right offline). Written as JSON; a bare string is read back
 * as a token with no profile rather than treated as corrupt.
 */
interface StaffSession extends StaffProfile {
  token: string;
}

function decodeStaffSession(raw: string | null): StaffSession | null {
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Partial<StaffSession>;
      if (typeof parsed.token === "string" && parsed.token) {
        return {
          token: parsed.token,
          name: typeof parsed.name === "string" ? parsed.name : "",
          email: typeof parsed.email === "string" ? parsed.email : "",
        };
      }
    } catch {
      /* unreadable — treated as no session below */
    }
    return null;
  }
  return { token: raw, name: "", email: "" };
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { t, applyProfileLocale } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [staffToken, setStaffToken] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);
  const [cancelled, setCancelled] = useState(0);
  const [googleReady] = useState(() => googleConfigured && loadGoogle() !== null);
  // `providers` is only populated once something calls refreshProviders
  // (the account screen does, on mount) — deliberately not at boot: the
  // endpoint mints a Redis-backed device code on every call.
  const googleAvailable = googleReady || providers.some((p) => p.id === "google");

  useEffect(() => {
    const guest = readToken()
      .then((saved) => {
        if (saved) setToken(saved);
      })
      .catch(() => {});
    // The restaurant session is restored exactly like the guest's — the
    // counter tablet is signed in until someone signs it out.
    const restaurantSession = readStaffToken()
      .then((saved) => {
        const session = decodeStaffSession(saved);
        if (!session) return;
        setStaffToken(session.token);
        setStaff({ name: session.name, email: session.email });
      })
      .catch(() => {});
    // `ready` flips only once BOTH slots have been looked at, and always
    // after whatever they found has been queued — so the render that first
    // sees `ready` already sees the restored session. An unreadable slot
    // (keychain locked, corrupt value) still settles: it counts as "no
    // session", never as "still restoring".
    void Promise.all([guest, restaurantSession]).then(() => setReady(true));
  }, []);

  /**
   * Coming back from the web with `?status=reset` (P7-15).
   *
   * The reset revoked every token that customer had, so whatever this
   * device is holding is already refused by the server — dropping it
   * here just means the guest sees the sign-in form instead of a screen
   * that 401s a second later.
   *
   * `useURL` covers both shapes of arrival: a cold start FROM the link,
   * and a link that foregrounds an app already running. Each URL is
   * acted on once — the hook re-serves the same value on re-renders (and
   * on a language change, which re-runs this effect).
   */
  const returnedUrl = ExpoLinking.useURL();
  const handledUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!returnedUrl || handledUrl.current === returnedUrl) return;
    handledUrl.current = returnedUrl;
    let status: unknown;
    try {
      status = ExpoLinking.parse(returnedUrl).queryParams?.status;
    } catch {
      return; // Not a URL we can read — it is not ours either.
    }
    if (status !== RESET_STATUS) return;
    setToken(null);
    setCustomer(null);
    void clearToken();
    Alert.alert(t.resetDoneTitle, t.resetDoneBody);
  }, [returnedUrl, t]);

  // Validate the stored token + load the profile whenever it changes.
  useEffect(() => {
    if (!token) {
      setCustomer(null);
      return;
    }
    let alive = true;
    fetch(`${BASE_URL}/api/v1/me`, { headers: { "X-Customer-Token": token } })
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 401) {
          setToken(null);
          await clearToken();
          return;
        }
        const body = (await res.json()) as { customer?: CustomerProfile };
        if (body.customer) setCustomer(body.customer);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  /**
   * One language for the whole app, taken from the account.
   *
   * Fires on every route into a customer session — the sign-in calls
   * below (which `adopt` a profile) and the token-validating restore
   * above — because both land here as a `customer` with a `locale`. The
   * i18n layer ignores a null/unknown/not-offered code, so a guest who
   * never picked one keeps whatever the venue default gave them.
   */
  useEffect(() => {
    applyProfileLocale(customer?.locale);
  }, [customer?.locale, applyProfileLocale]);

  // A device is a guest's phone OR the restaurant's — adopting either
  // session tears the other one down, so the two can never overlap.
  const adopt = useCallback(async (next: string, profile?: CustomerProfile | null) => {
    setToken(next);
    if (profile) setCustomer(profile);
    setStaffToken(null);
    setStaff(null);
    await clearStaffToken();
    await writeToken(next);
  }, []);

  const adoptStaff = useCallback(async (next: string, profile: StaffProfile) => {
    setStaffToken(next);
    setStaff(profile);
    setToken(null);
    setCustomer(null);
    await clearToken();
    await writeStaffToken(JSON.stringify({ token: next, ...profile } satisfies StaffSession));
  }, []);

  const refreshProviders = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/device`, { method: "POST" });
      const body = (await res.json()) as { providers?: { id: string; label: string }[] };
      if (body.providers) setProviders(body.providers.map(({ id, label }) => ({ id, label })));
    } catch {
      /* offline — the account screen shows the retry state */
    }
  }, []);

  const login = useCallback(
    async (providerId: string): Promise<boolean> => {
      setBusyProvider(providerId);
      const myAttempt = cancelled;
      try {
        // Where the browser must end up. The server parks it WITH the
        // device code (never in the OAuth state) and the sign-in callback
        // bounces to it; `openAuthSessionAsync` then closes the tab on it.
        const returnUrl = appReturnUrl();
        const res = await fetch(`${BASE_URL}/api/v1/auth/device`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ app: returnUrl }),
        });
        const body = (await res.json()) as {
          code?: string;
          providers?: { id: string; loginUrl: string }[];
        };
        const entry = body.providers?.find((p) => p.id === providerId);
        if (!body.code || !entry) return false;
        // Not awaited: the browser may sit open for minutes, and the poll
        // below is what actually ends the sign-in. Settling it early (the
        // deep link fired, or the guest dismissed the tab) just short-
        // circuits the current 3-second wait so the signed-in state shows
        // the instant the app is back on screen.
        let browserClosed = false;
        const session = openReturningPage(entry.loginUrl, returnUrl).then(
          () => {
            browserClosed = true;
          },
          () => {
            browserClosed = true;
          },
        );
        // Poll up to 5 minutes for the browser flow to finish.
        for (let i = 0; i < 100; i += 1) {
          const tick = new Promise((r) => setTimeout(r, 3000));
          await (browserClosed ? tick : Promise.race([tick, session]));
          if (cancelled !== myAttempt) return false;
          const poll = await fetch(`${BASE_URL}/api/v1/auth/device/${body.code}`);
          if (poll.status === 404) return false; // expired
          const data = (await poll.json()) as {
            status?: string;
            token?: string;
            customer?: CustomerProfile;
          };
          if (data.status === "ok" && data.token) {
            await adopt(data.token, data.customer);
            return true;
          }
        }
        return false;
      } catch {
        return false;
      } finally {
        setBusyProvider(null);
      }
    },
    [cancelled, adopt],
  );

  const loginWithGoogle = useCallback(async (): Promise<GoogleOutcome> => {
    const mod = loadGoogle();
    if (!mod) return "unavailable";
    setBusyProvider(GOOGLE_NATIVE);
    try {
      const { GoogleSignin } = mod;
      GoogleSignin.configure({
        ...(GOOGLE_WEB_CLIENT_ID ? { webClientId: GOOGLE_WEB_CLIENT_ID } : {}),
        ...(GOOGLE_IOS_CLIENT_ID ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
        scopes: ["email", "profile"],
      });
      if (Platform.OS === "android") {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }
      const result = await GoogleSignin.signIn();
      if (result.type !== "success") return "cancelled";
      const idToken = result.data?.idToken;
      if (!idToken) return "failed";
      // The session lives on our own token, not Google's — drop the
      // native session so the next sign-in shows the account chooser.
      await GoogleSignin.signOut().catch(() => {});
      const res = await fetch(`${BASE_URL}/api/auth/customer/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        token?: string;
        customer?: CustomerProfile;
      };
      // 503 = the server has no Google client ids configured; the browser
      // flow is the only route that can work, so say "unavailable".
      if (res.status === 503) return "unavailable";
      if (!res.ok || !body.token) return "failed";
      await adopt(body.token, body.customer);
      return null;
    } catch {
      return "failed";
    } finally {
      setBusyProvider(null);
    }
  }, [adopt]);

  const loginWithEmail = useCallback(
    async (
      mode: "login" | "register",
      email: string,
      password: string,
      name?: string,
    ): Promise<"invalid" | "exists" | "failed" | null> => {
      try {
        const res = await fetch(
          `${BASE_URL}/api/auth/customer/${mode === "register" ? "register" : "login"}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              mode === "register"
                ? { email, password, name: name || undefined }
                : { email, password },
            ),
          },
        );
        const body = (await res.json().catch(() => ({}))) as {
          kind?: string;
          token?: string;
          customer?: CustomerProfile;
          restaurant?: { name?: string; email?: string };
          error?: string;
        };
        if (!res.ok || !body.token) {
          if (body.error === "exists") return "exists";
          if (
            res.status === 401 ||
            body.error === "invalid" ||
            body.error === "invalid_credentials"
          )
            return "invalid";
          return "failed";
        }
        // The SERVER decides which kind of credentials these were. `kind`
        // is the contract; the `restaurant` block alone is accepted too,
        // so a server that forgets the discriminator still works.
        if (body.kind === "restaurant" || (body.restaurant && !body.customer)) {
          await adoptStaff(body.token, {
            name: body.restaurant?.name ?? "",
            email: body.restaurant?.email ?? email,
          });
          return null;
        }
        await adopt(body.token, body.customer);
        return null;
      } catch {
        return "failed";
      }
    },
    [adopt, adoptStaff],
  );

  const cancelLogin = useCallback(() => {
    setCancelled((n) => n + 1);
    setBusyProvider(null);
  }, []);

  const logout = useCallback(async () => {
    const current = token;
    setToken(null);
    setCustomer(null);
    await clearToken();
    if (current) {
      fetch(`${BASE_URL}/api/v1/me`, {
        method: "DELETE",
        headers: { "X-Customer-Token": current },
      }).catch(() => {});
    }
  }, [token]);

  const clearStaff = useCallback(() => {
    setStaffToken(null);
    setStaff(null);
    void clearStaffToken();
  }, []);

  /** Same slot, same profile, new bearer. Persisted before it is
   *  announced, so a crash between the two leaves the device holding the
   *  token that still works rather than the one that no longer does. */
  const replaceStaffToken = useCallback(
    async (next: string) => {
      if (!staff || !next) return;
      await writeStaffToken(JSON.stringify({ token: next, ...staff } satisfies StaffSession));
      setStaffToken(next);
    },
    [staff],
  );

  const logoutStaff = useCallback(async () => {
    const current = staffToken;
    setStaffToken(null);
    setStaff(null);
    await clearStaffToken();
    if (current) {
      // Order matters: the push device is deleted with the token that
      // still authorises it, THEN the session itself is ended (P7-11).
      // A phone that keeps receiving the restaurant's orders after it was
      // signed out is the one failure mode worth a round trip.
      await unregisterStaffPush(current);
      await staffLogout(current);
    }
  }, [staffToken]);

  const fetchMyOrders = useCallback(async (): Promise<AccountOrder[]> => {
    if (!token) return [];
    const res = await fetch(`${BASE_URL}/api/v1/me`, { headers: { "X-Customer-Token": token } });
    if (!res.ok) return [];
    const body = (await res.json()) as { orders?: AccountOrder[] };
    return body.orders ?? [];
  }, [token]);

  /**
   * Persist the language the guest just picked onto their profile.
   *
   * Fire-and-forget by design: the app has ALREADY switched language, so
   * a failed round trip must not undo it, block the picker, or show an
   * error — the account simply keeps the previous value until the next
   * change succeeds. The local copy is updated optimistically so the
   * profile effect above doesn't fight the change on the next render.
   */
  const saveLocale = useCallback(
    (locale: string) => {
      if (!token) return;
      setCustomer((current) => (current ? { ...current, locale } : current));
      fetch(`${BASE_URL}/api/v1/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Customer-Token": token },
        body: JSON.stringify({ locale }),
      }).catch(() => {});
    },
    [token],
  );

  const api = useMemo<AuthApi>(
    () => ({
      token,
      customer,
      ready,
      staff,
      staffToken,
      logoutStaff,
      clearStaff,
      replaceStaffToken,
      busyProvider,
      providers,
      googleAvailable,
      refreshProviders,
      login,
      loginWithGoogle,
      loginWithEmail,
      cancelLogin,
      logout,
      fetchMyOrders,
      saveLocale,
    }),
    [
      token,
      customer,
      ready,
      staff,
      staffToken,
      logoutStaff,
      clearStaff,
      replaceStaffToken,
      busyProvider,
      providers,
      googleAvailable,
      refreshProviders,
      login,
      loginWithGoogle,
      loginWithEmail,
      cancelLogin,
      logout,
      fetchMyOrders,
      saveLocale,
    ],
  );
  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
