/**
 * Password-reset email, in the shared branded shell.
 */
import { BRAND } from "@/lib/brand";
import { Button, EmailShell, platformBrand, styles } from "./layout";

export interface ResetPasswordEmailProps {
  resetUrl: string;
}

export function ResetPasswordEmail({ resetUrl }: ResetPasswordEmailProps): React.ReactElement {
  return (
    <EmailShell
      lang="en"
      dir="ltr"
      brand={platformBrand(BRAND.name)}
      title={`Reset your ${BRAND.name} password`}
      footer="If you did not request a reset, you can ignore this email — your password stays as it is."
    >
      <p style={styles.eyebrow}>{BRAND.name}</p>
      <h1 style={styles.h1}>Reset your {BRAND.name} password</h1>
      <p style={styles.lead}>Choose a new password with the button below:</p>
      <Button href={resetUrl} label="Choose a new password" />
      <p style={{ ...styles.muted, fontSize: 12, wordBreak: "break-all" }}>
        Or paste this link into your browser:{" "}
        <a href={resetUrl} style={{ color: "#8f1a1a" }}>
          {resetUrl}
        </a>
      </p>
      <p style={{ ...styles.muted, fontSize: 12 }}>This link expires in 1 hour.</p>
    </EmailShell>
  );
}
