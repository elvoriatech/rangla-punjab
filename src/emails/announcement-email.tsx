/**
 * Platform announcement broadcast from the admin console. Plain-HTML
 * placeholder like the other templates; the message is owner-facing
 * copy written by Guesto staff, rendered as paragraphs.
 */
import { BRAND } from "@/lib/brand";

export interface AnnouncementEmailProps {
  venueName: string;
  message: string;
}

export function AnnouncementEmail({
  venueName,
  message,
}: AnnouncementEmailProps): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <p>Hi {venueName},</p>
        {message.split(/\n{2,}/).map((para) => (
          <p key={para.slice(0, 40)}>{para}</p>
        ))}
        <p>
          — The {BRAND.name} team
          <br />
          <a href="https://guesto.app">elvoria.eu</a>
        </p>
      </body>
    </html>
  );
}
