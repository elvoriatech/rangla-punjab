/**
 * Placeholder verification email. Real design + copy lands with P1-2b when
 * we wire the token flow. Structure is deliberately plain HTML — no React
 * Email components yet, no CSS inlining — so the template renders in any
 * server context and swapping to a designed template later is contained.
 */
import { BRAND } from "@/lib/brand";

export interface VerifyEmailProps {
  verifyUrl: string;
}

export function VerifyEmail({ verifyUrl }: VerifyEmailProps): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <h1>Confirm your {BRAND.name} email</h1>
        <p>Click the link below to activate your account:</p>
        <p>
          <a href={verifyUrl}>{verifyUrl}</a>
        </p>
        <p>This link expires in 24 hours.</p>
      </body>
    </html>
  );
}
