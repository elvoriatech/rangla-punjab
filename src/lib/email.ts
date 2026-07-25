import type { ReactElement } from "react";
import { env } from "./env";
import { logger } from "./logger";
import { getOperatorSettings } from "./operator-settings";

// `react-dom/server` is imported dynamically inside `sendEmail` so Next's
// dev bundler doesn't chase the import into a client boundary and refuse to
// bundle. The email seam is server-only, but the graph analysis is coarse.
async function renderHtml(el: ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(el);
}

/**
 * The one seam callers use to send mail. Routes to MailHog (dev/test),
 * Resend (prod), or the console (CI smoke) based on `EMAIL_TRANSPORT`.
 * Templates are React components rendered to a static HTML string here —
 * the transport never sees JSX.
 */
export interface SendEmailInput {
  to: string;
  subject: string;
  react: ReactElement;
}

export interface SentMessage {
  transport: "mailhog" | "resend" | "console";
  messageId?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<SentMessage> {
  const html = await renderHtml(input.react);
  // Transport + From are runtime-overridable from the Operator Console;
  // an unset override (NULL) falls back to the env value, so a deploy that
  // never touches the console behaves exactly as before. The Resend API
  // key is deliberately NOT overridable — it stays an env secret.
  const settings = await getOperatorSettings();
  const transport = settings.emailTransport ?? env.EMAIL_TRANSPORT;
  const from = settings.emailFrom ?? env.EMAIL_FROM;
  const payload = { from, to: input.to, subject: input.subject, html };

  switch (transport) {
    case "mailhog":
      return sendViaMailhog(payload);
    case "resend":
      return sendViaResend(payload);
    case "console":
      logger.info("email.console", { to: input.to, subject: input.subject });
      return { transport: "console" };
  }
}

interface Payload {
  from: string;
  to: string;
  subject: string;
  html: string;
}

async function sendViaMailhog(p: Payload): Promise<SentMessage> {
  // Dynamic import so pulling nodemailer into a Next edge bundle doesn't
  // happen accidentally — sendEmail is server-only, but this keeps the seam
  // honest.
  const { createTransport } = await import("nodemailer");
  const transport = createTransport({
    host: env.MAILHOG_SMTP_HOST,
    port: env.MAILHOG_SMTP_PORT,
    secure: false,
    // MailHog accepts any auth; skip auth entirely to keep the local sink
    // frictionless.
    ignoreTLS: true,
  });
  const info = await transport.sendMail(p);
  return { transport: "mailhog", messageId: info.messageId };
}

async function sendViaResend(p: Payload): Promise<SentMessage> {
  if (!env.RESEND_API_KEY) {
    throw new Error("EMAIL_TRANSPORT=resend but RESEND_API_KEY is not set");
  }
  const { Resend } = await import("resend");
  const client = new Resend(env.RESEND_API_KEY);
  const { data, error } = await client.emails.send({
    from: p.from,
    to: p.to,
    subject: p.subject,
    html: p.html,
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
  return { transport: "resend", messageId: data?.id };
}
