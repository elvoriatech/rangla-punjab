/**
 * Trial-ending notice. Stripe fires `customer.subscription.trial_will_end`
 * three days before the trial expires — enough time for the owner to
 * come back, review, and add a card. Real design + copy come with the
 * broader email design pass; this is the plain-HTML placeholder.
 */
import { BRAND } from "@/lib/brand";

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
    <html lang="en">
      <body>
        <h1>Your {BRAND.name} trial ends soon</h1>
        <p>Hi {tenantName},</p>
        <p>
          Your {BRAND.name} trial ends on <strong>{trialEndsAt}</strong>. To keep your menu online,
          add a payment method:
        </p>
        <p>
          <a href={portalUrl}>{portalUrl}</a>
        </p>
        <p>
          If you decide not to continue, no action is needed — the trial will simply end and your
          menu will go read-only.
        </p>
      </body>
    </html>
  );
}
