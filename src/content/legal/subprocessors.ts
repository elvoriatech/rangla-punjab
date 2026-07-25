/**
 * Sub-processor list, rendered as a table on the DPA page (P1-22a) and
 * kept in sync with the DPAs we sign. Adding a row here is a real
 * compliance action (may require customer notification per Art. 28 GDPR)
 * so treat this file as production copy.
 */

export interface Subprocessor {
  name: string;
  purpose: string;
  region: string;
  dpaUrl: string;
}

export const SUBPROCESSORS: readonly Subprocessor[] = Object.freeze([
  {
    name: "IONOS",
    purpose: "EU-hosted infrastructure (compute, database, object storage)",
    region: "DE",
    dpaUrl: "https://www.ionos.com/terms-gtc/data-processing-agreement",
  },
  {
    name: "Cloudflare",
    purpose: "CDN + WAF in front of the public menu pages",
    region: "Global (EU regional edge)",
    dpaUrl: "https://www.cloudflare.com/cloudflare-customer-dpa",
  },
  {
    name: "Stripe Payments Europe, Ltd.",
    purpose: "Payment processing, invoicing, tax handling",
    region: "IE / US",
    dpaUrl: "https://stripe.com/legal/dpa",
  },
  {
    name: "Resend",
    purpose: "Transactional email delivery",
    region: "EU (eu-west-1)",
    dpaUrl: "https://resend.com/legal/dpa",
  },
  {
    name: "Sentry",
    purpose: "Error tracking + structured logging",
    region: "EU (Frankfurt)",
    dpaUrl: "https://sentry.io/legal/dpa",
  },
]);
