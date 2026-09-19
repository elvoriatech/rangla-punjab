import { NextResponse } from "next/server";

/**
 * CORS for the mobile-app-facing endpoints. Native fetch has no origin
 * checks — this exists for the Expo web/dev surface and costs nothing
 * otherwise. Safe to be permissive: these routes carry no cookies and
 * authorize by receipt token (or are public reads).
 */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  // PATCH/DELETE are the /api/v1/me profile edit + logout verbs; native
  // fetch never preflights, but the Expo web surface does.
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  // X-Staff-Token is the restaurant's own credential for the app's orders
  // board — a separate header from the guest one on purpose, so neither
  // credential can ever be presented where the other is expected.
  "Access-Control-Allow-Headers": "Content-Type, X-Customer-Token, X-Staff-Token, Authorization",
} as const;

export function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS }) as NextResponse;
}
