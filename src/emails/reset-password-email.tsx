/**
 * Placeholder password-reset email. Same shape as `verify-email.tsx` —
 * plain HTML now, designed template later in P1-2b.
 */
import { BRAND } from "@/lib/brand";

export interface ResetPasswordEmailProps {
  resetUrl: string;
}

export function ResetPasswordEmail({ resetUrl }: ResetPasswordEmailProps): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <h1>Reset your {BRAND.name} password</h1>
        <p>Click the link below to choose a new password:</p>
        <p>
          <a href={resetUrl}>{resetUrl}</a>
        </p>
        <p>
          This link expires in 1 hour. If you did not request a reset, you can ignore this email.
        </p>
      </body>
    </html>
  );
}
