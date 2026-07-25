import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { env } from "./env";
import { sendEmail } from "./email";
import { VerifyEmail } from "@/emails/verify-email";

// Integration test: send a message through the MailHog transport and read
// it back via MailHog's HTTP API. Requires the local `mailhog` service
// (docker-compose in dev, GitHub Actions service in CI).

interface MailhogItem {
  ID: string;
  Content: { Headers: Record<string, string[]>; Body: string };
  To: { Mailbox: string; Domain: string }[];
}

async function fetchMailFor(recipient: string): Promise<MailhogItem[]> {
  // Filter by recipient so this test is resilient to the other suites
  // (verification-service, signup flows in public-menu) that share MailHog
  // under vitest's default parallel execution.
  const res = await fetch(`${env.MAILHOG_API_URL}/api/v2/messages`);
  if (!res.ok) throw new Error(`MailHog API returned ${res.status}`);
  const all = ((await res.json()) as { items: MailhogItem[] }).items;
  return all.filter((m) => `${m.To[0]!.Mailbox}@${m.To[0]!.Domain}` === recipient);
}

describe.runIf(env.EMAIL_TRANSPORT === "mailhog")("sendEmail via MailHog", () => {
  it("delivers the rendered email to MailHog with the expected recipient and subject", async () => {
    const to = `p1-3-${randomUUID()}@ex.com`;
    const subject = `Verify ${randomUUID()}`;
    const verifyUrl = `https://elvoria.eu/api/auth/verify/${randomUUID()}`;

    const result = await sendEmail({
      to,
      subject,
      react: VerifyEmail({ verifyUrl }),
    });
    expect(result.transport).toBe("mailhog");

    const items = await fetchMailFor(to);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.To[0]!.Mailbox + "@" + item.To[0]!.Domain).toBe(to);
    expect(item.Content.Headers.Subject?.[0]).toBe(subject);
    // nodemailer sends the HTML as quoted-printable, which inserts `=` soft
    // line breaks inside long URLs. Undo those before asserting so the
    // token round-trip check is not brittle to line wrapping.
    const decoded = item.Content.Body.replace(/=\r?\n/g, "");
    expect(decoded).toContain(verifyUrl);
  });
});
