import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VerifyEmail } from "./verify-email";
import { ResetPasswordEmail } from "./reset-password-email";
import { EmailShell, type Brand } from "./layout";

const BANNER = "https://elvoria.eu/img/banner-abc.jpg";
const LOGO = "https://elvoria.eu/img/logo-abc.png";

/** One branded shell, rendered the way every email in here renders it. */
function shell(brand: Brand): string {
  return renderToStaticMarkup(
    <EmailShell lang="en" dir="ltr" brand={brand} title="Order 0012">
      <p>Body</p>
    </EmailShell>,
  );
}

describe("EmailShell — the green frame every notification shares", () => {
  it("opens with the brand header image, not the venue's photo banner", () => {
    const html = shell({
      name: "Rangla Punjab",
      logoUrl: LOGO,
      bannerUrl: BANNER,
      accent: "#123456",
    });
    // The same header image as the order confirmation, named for image-blocking clients.
    expect(html).toMatch(/<img[^>]+src="[^"]*\/brand\/email-header\.png"/);
    expect(html).toContain('alt="Rangla Punjab"');
    // One look for every email (owner, 2026-09-30): no photo banner, no
    // per-venue colour band, the confirmation's green instead.
    expect(html).not.toContain(BANNER);
    expect(html).not.toContain("background-image");
    expect(html).not.toContain("#123456");
    expect(html).toContain("background-color:#f3f5ef");
  });

  it("keeps each email's own content inside the frame", () => {
    const html = shell({ name: "Rangla Punjab", logoUrl: null, bannerUrl: null });
    expect(html).toContain("<p>Body</p>");
    expect(html).not.toContain("Thank You");
  });
});

describe("email templates", () => {
  it("verify email substitutes the token URL and links to it", () => {
    const url = "https://elvoria.eu/api/auth/verify/abc123";
    const html = renderToStaticMarkup(<VerifyEmail verifyUrl={url} />);
    expect(html).toContain(url);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("24 hours");
  });

  it("reset email substitutes the token URL and links to it", () => {
    const url = "https://elvoria.eu/reset/xyz456";
    const html = renderToStaticMarkup(<ResetPasswordEmail resetUrl={url} />);
    expect(html).toContain(url);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("1 hour");
  });
});
