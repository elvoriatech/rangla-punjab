import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { customerCallbackUrl } from "@/lib/customer-auth";

/**
 * The DEV identity provider (never in production): a plain HTML form that
 * plays Google/Microsoft's role so the whole sign-in flow is clickable
 * locally with no credentials. Submitting builds the "authorization code"
 * (base64url identity JSON) and redirects to the real callback — the same
 * path a real provider takes.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const email = req.nextUrl.searchParams.get("email");
  const name = req.nextUrl.searchParams.get("name") ?? "";

  // Second leg: the form submitted back to us — build the code, bounce
  // to the callback exactly like a real IdP would.
  if (email) {
    const code = Buffer.from(JSON.stringify({ email, name })).toString("base64url");
    const cb = new URL(customerCallbackUrl());
    cb.searchParams.set("code", code);
    cb.searchParams.set("state", state);
    return NextResponse.redirect(cb.toString(), 303);
  }

  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dev-Login</title>
<style>
  body{font-family:system-ui;background:#faf3e3;color:#35200f;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  form{background:#fffaf0;border:1px solid #e6d9bd;border-radius:14px;padding:28px;width:320px}
  h1{font-size:18px;margin:0 0 4px}p{font-size:12px;color:#6f5b45;margin:0 0 16px}
  label{display:block;font-size:12px;font-weight:600;margin:10px 0 4px}
  input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #e6d9bd;border-radius:8px;font-size:14px}
  button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:999px;background:#9d1c1c;color:#fdf3dd;font-weight:700;font-size:14px;cursor:pointer}
</style></head><body>
<form method="GET">
  <h1>Dev-Login (lokaler Test)</h1>
  <p>Spielt Google/Microsoft nur lokal nach — in Produktion existiert diese Seite nicht.</p>
  <input type="hidden" name="state" value="${state.replaceAll('"', "&quot;")}">
  <label for="email">E-Mail</label>
  <input id="email" name="email" type="email" required placeholder="gast@example.com">
  <label for="name">Name</label>
  <input id="name" name="name" type="text" placeholder="Sabir Khan">
  <button type="submit">Anmelden</button>
</form></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
