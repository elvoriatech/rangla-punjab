/**
 * Trial-ending notice, in the shared branded shell. Stripe fires
 * `customer.subscription.trial_will_end` three days before the trial
 * expires — enough time for the owner to come back, review, and add a card.
 */
import { BRAND } from "@/lib/brand";
import { Button, EmailShell, platformBrand, styles } from "./layout";

export interface TrialEndingEmailProps {
  tenantName: string;
  trialEndsAt: string; // human-formatted date
  portalUrl: string;
}

export function TrialEndingEmail({
  tenantName,
  trialEndsAt,
  portalUrl,
}: TrialEndingEmailProps): React.ReactElement {
  return (
    <EmailShell
      lang="en"
      dir="ltr"
      brand={platformBrand(BRAND.name)}
      title={`Your ${BRAND.name} trial ends soon`}
      footer="If you decide not to continue, no action is needed — the trial simply ends and your menu goes read-only."
    >
      <p style={styles.eyebrow}>{BRAND.name}</p>
      <h1 style={styles.h1}>Your trial ends soon</h1>
      <p style={styles.lead}>Hi {tenantName},</p>
      <p style={{ margin: "0 0 16px" }}>
        Your {BRAND.name} trial ends on <strong>{trialEndsAt}</strong>. To keep your menu online,
        add a payment method:
      </p>
      <Button href={portalUrl} label="Add a payment method" />
      <p style={{ ...styles.muted, fontSize: 12, wordBreak: "break-all" }}>
        <a href={portalUrl} style={{ color: "#8f1a1a" }}>
          {portalUrl}
        </a>
      </p>
    </EmailShell>
  );
}
