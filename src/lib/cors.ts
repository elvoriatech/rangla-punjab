import { NextResponse } from "next/server";

/**
 * CORS for the mobile-app-facing endpoints. Native fetch has no origin
 * checks — this exists for the Expo web/dev surface and costs nothing
 * otherwise. Safe to be permissive: these routes carry no cookies and
 * authorize by receipt token (or are public reads).
 */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Customer-Token, Authorization",
} as const;

export function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS }) as NextResponse;
}
