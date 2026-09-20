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

describe("EmailShell header", () => {
  it("puts the banner behind the header and the logo on top of it", () => {
    const html = shell({ name: "Rangla Punjab", logoUrl: LOGO, bannerUrl: BANNER, accent: null });
    // The photo is a BACKGROUND, both ways, so every client gets one.
    expect(html).toContain(`background="${BANNER}"`);
    expect(html).toMatch(/background-image:\s*url\(https:\/\/elvoria\.eu\/img\/banner-abc\.jpg\)/);
    // The logo medallion still renders, with its alt text.
    expect(html).toContain(`src="${LOGO}"`);
    expect(html).toContain('alt="Rangla Punjab"');
    // …and the banner is no longer a standalone <img>, which is what used
    // to push the coloured band down into a second header band.
    expect(html).not.toContain(`<img src="${BANNER}"`);
    expect(html).not.toMatch(
      new RegExp(`<img[^>]+${BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  });

  it("keeps the coloured band when there is no banner", () => {
    const html = shell({
      name: "Rangla Punjab",
      logoUrl: LOGO,
      bannerUrl: null,
      accent: "#123456",
    });
    expect(html).not.toContain("background-image");
    expect(html).toContain("background-color:#123456");
    expect(html).toContain(`src="${LOGO}"`);
    expect(html).toContain("Rangla Punjab");
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
