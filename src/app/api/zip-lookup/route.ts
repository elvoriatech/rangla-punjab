import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";

/**
 * ZIP → locality lookup for the delivery-areas editor. Proxied server-side so
 * the dashboard calls same-origin (no CORS/CSP), the result is cached, and the
 * vendor can be swapped without touching the client.
 *
 * Vendor: OpenPLZ API (openplzapi.org) — free, no API key, German-focused
 * (also AT/CH/LI). Returns the locality name plus district + federal state,
 * so the editor can enrich later. Session-gated so it isn't an open proxy.
 */
const OPENPLZ_COUNTRIES = new Set(["de", "at", "ch", "li"]);

interface OpenPlzLocality {
  name?: string;
  district?: { name?: string };
  federalState?: { name?: string };
}

export async function GET(req: Request): Promise<NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ locality: null }, { status: 401 });

  const url = new URL(req.url);
  const zip = (url.searchParams.get("zip") ?? "").trim();
  const country = (url.searchParams.get("country") ?? "de").toLowerCase().replace(/[^a-z]/g, "");
  if (!/^\d{4,5}$/.test(zip) || !OPENPLZ_COUNTRIES.has(country)) {
    return NextResponse.json({ locality: null }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://openplzapi.org/${country}/Localities?postalCode=${encodeURIComponent(zip)}`,
      { signal: AbortSignal.timeout(4000), headers: { accept: "application/json" } },
    );
    if (!res.ok) return NextResponse.json({ locality: null }, { status: 404 });
    const data = (await res.json()) as OpenPlzLocality[];
    const first = Array.isArray(data) ? data[0] : undefined;
    const locality = first?.name?.trim() || null;
    return NextResponse.json(
      {
        locality,
        district: first?.district?.name?.trim() || null,
        state: first?.federalState?.name?.trim() || null,
      },
      { headers: { "cache-control": "private, max-age=86400" } },
    );
  } catch {
    // Network/timeout — the owner can still type the locality by hand.
    return NextResponse.json({ locality: null }, { status: 502 });
  }
}
