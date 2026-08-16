import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BASE_URL } from "./api";

/**
 * Customer sign-in for the app — the hand-rolled device flow: the app
 * mints a device code, opens the provider login in the system browser
 * (Google / Microsoft / local dev form), and polls until the backend
 * parks the opaque customer token under that code. No deep links, no
 * OAuth SDK, works in Expo Go.
 */

export interface CustomerProfile {
  email: string;
  name: string | null;
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

interface AuthApi {
  token: string | null;
  customer: CustomerProfile | null;
  busyProvider: string | null;
  providers: { id: string; label: string }[];
  refreshProviders: () => Promise<void>;
  login: (providerId: string) => Promise<boolean>;
  cancelLogin: () => void;
  logout: () => Promise<void>;
  fetchMyOrders: () => Promise<AccountOrder[]>;
}

const AuthContext = createContext<AuthApi | null>(null);
const KEY = "rangla-customer-token";

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [token, setToken] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);
  const [cancelled, setCancelled] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((saved) => {
      if (saved) setToken(saved);
    });
  }, []);

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
          await AsyncStorage.removeItem(KEY);
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
        const res = await fetch(`${BASE_URL}/api/v1/auth/device`, { method: "POST" });
        const body = (await res.json()) as {
          code?: string;
          providers?: { id: string; loginUrl: string }[];
        };
        const entry = body.providers?.find((p) => p.id === providerId);
        if (!body.code || !entry) return false;
        await Linking.openURL(entry.loginUrl);
        // Poll up to 5 minutes for the browser flow to finish.
        for (let i = 0; i < 100; i += 1) {
          await new Promise((r) => setTimeout(r, 3000));
          if (cancelled !== myAttempt) return false;
          const poll = await fetch(`${BASE_URL}/api/v1/auth/device/${body.code}`);
          if (poll.status === 404) return false; // expired
          const data = (await poll.json()) as {
            status?: string;
            token?: string;
            customer?: CustomerProfile;
          };
          if (data.status === "ok" && data.token) {
            setToken(data.token);
            if (data.customer) setCustomer(data.customer);
            await AsyncStorage.setItem(KEY, data.token);
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
    [cancelled],
  );

  const cancelLogin = useCallback(() => {
    setCancelled((n) => n + 1);
    setBusyProvider(null);
  }, []);

  const logout = useCallback(async () => {
    const current = token;
    setToken(null);
    setCustomer(null);
    await AsyncStorage.removeItem(KEY);
    if (current) {
      fetch(`${BASE_URL}/api/v1/me`, {
        method: "DELETE",
        headers: { "X-Customer-Token": current },
      }).catch(() => {});
    }
  }, [token]);

  const fetchMyOrders = useCallback(async (): Promise<AccountOrder[]> => {
    if (!token) return [];
    const res = await fetch(`${BASE_URL}/api/v1/me`, { headers: { "X-Customer-Token": token } });
    if (!res.ok) return [];
    const body = (await res.json()) as { orders?: AccountOrder[] };
    return body.orders ?? [];
  }, [token]);

  const api = useMemo<AuthApi>(
    () => ({
      token,
      customer,
      busyProvider,
      providers,
      refreshProviders,
      login,
      cancelLogin,
      logout,
      fetchMyOrders,
    }),
    [
      token,
      customer,
      busyProvider,
      providers,
      refreshProviders,
      login,
      cancelLogin,
      logout,
      fetchMyOrders,
    ],
  );
  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
