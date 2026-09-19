/**
 * Account verification email, in the shared branded shell.
 */
import { BRAND } from "@/lib/brand";
import { Button, EmailShell, platformBrand, styles } from "./layout";

export interface VerifyEmailProps {
  verifyUrl: string;
}

export function VerifyEmail({ verifyUrl }: VerifyEmailProps): React.ReactElement {
  return (
    <EmailShell
      lang="en"
      dir="ltr"
      brand={platformBrand(BRAND.name)}
      title={`Confirm your ${BRAND.name} email`}
      footer={`This link expires in 24 hours. If you did not create an account, you can ignore this email.`}
    >
      <p style={styles.eyebrow}>{BRAND.name}</p>
      <h1 style={styles.h1}>Confirm your {BRAND.name} email</h1>
      <p style={styles.lead}>One tap activates your account:</p>
      <Button href={verifyUrl} label="Confirm email" />
      <p style={{ ...styles.muted, fontSize: 12, wordBreak: "break-all" }}>
        Or paste this link into your browser:{" "}
        <a href={verifyUrl} style={{ color: "#8f1a1a" }}>
          {verifyUrl}
        </a>
      </p>
      <p style={{ ...styles.muted, fontSize: 12 }}>This link expires in 24 hours.</p>
    </EmailShell>
  );
}
