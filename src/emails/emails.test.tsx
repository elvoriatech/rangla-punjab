import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VerifyEmail } from "./verify-email";
import { ResetPasswordEmail } from "./reset-password-email";

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
