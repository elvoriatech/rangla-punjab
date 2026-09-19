import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppReturnView } from "./app-return-view";

/**
 * The hand-over page reflects a URL into a `<meta refresh>`, an anchor
 * and a `location.replace()` — three open-redirect holes if the value
 * were ever taken at face value. Every assertion below is about the
 * allow-list holding.
 */

const render = (
  to: string | null | undefined,
  locale = "en",
  status: "success" | "failed" | "reset" | null = null,
): string =>
  renderToStaticMarkup(
    <AppReturnView to={to} locale={locale} venueName="Rangla Punjab" status={status} />,
  );

describe("<AppReturnView>", () => {
  it("hands the browser back to the app three ways", () => {
    const html = render("ranglapunjab://auth-return");

    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain('content="0;url=ranglapunjab://auth-return"');
    expect(html).toContain('href="ranglapunjab://auth-return"');
    expect(html).toContain('location.replace("ranglapunjab://auth-return")');
    expect(html).toContain("Back to the app");
    expect(html).toContain("You can close this window.");
  });

  it("takes an Expo dev-client link too", () => {
    expect(render("exp+rangla://auth-return")).toContain('href="exp+rangla://auth-return"');
  });

  it.each([
    "https://evil.example.com/steal",
    "http://evil.example.com",
    "javascript:alert(1)",
    "//evil.example.com",
    "ranglapunjab:/auth-return",
  ])("refuses %s", (to) => {
    const html = render(to);

    expect(html).not.toContain("evil.example.com");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("refresh");
    expect(html).not.toContain("location.replace");
    expect(html).not.toContain("<a ");
    // Nothing to tap, so the page says the one useful thing instead.
    expect(html).toContain("You can close this window.");
  });

  it("says nothing but the close line when the link is missing", () => {
    const html = render(undefined);

    expect(html).not.toContain("location.replace");
    expect(html).toContain("You can close this window.");
  });

  it("says how the payment went when the PayPal return leg sent the guest here", () => {
    const paid = render("ranglapunjab://payment-return", "en", "success");
    expect(paid).toContain("Paid ✓");
    expect(paid).not.toContain("You&#x27;re signed in");
    expect(paid).toContain('href="ranglapunjab://payment-return"');

    const failed = render("ranglapunjab://payment-return", "en", "failed");
    expect(failed).toContain("Payment didn&#x27;t go through");

    // The sign-in trip has no status, and keeps its own heading.
    expect(render("ranglapunjab://auth-return")).toContain("You&#x27;re signed in");
  });

  it("says the password changed when the reset page sent the guest here", () => {
    const html = render("ranglapunjab://auth-return", "en", "reset");
    expect(html).toContain("Password changed");
    // The app cannot just carry on — every session was revoked — so the
    // page has to say why a sign-in is coming.
    expect(html).toContain("please sign in with the new one");
    expect(html).not.toContain("You&#x27;re signed in");
    expect(html).toContain('href="ranglapunjab://auth-return"');

    expect(render("ranglapunjab://auth-return", "de", "reset")).toContain("Passwort geändert");
  });

  it("speaks the venue's language, and turns the page around for RTL", () => {
    const de = render("ranglapunjab://auth-return", "de");
    expect(de).toContain("Zurück zur App");
    expect(de).toContain("Sie können dieses Fenster schließen.");

    const ar = render("ranglapunjab://auth-return", "ar");
    expect(ar).toContain('dir="rtl"');
    expect(ar).toContain("العودة إلى التطبيق");
  });
});
