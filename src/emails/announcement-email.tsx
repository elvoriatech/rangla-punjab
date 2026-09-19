/**
 * Platform announcement broadcast from the admin console, in the shared
 * branded shell. The message is owner-facing copy written by staff,
 * rendered as paragraphs.
 */
import { BRAND } from "@/lib/brand";
import { EmailShell, platformBrand, styles } from "./layout";

export interface AnnouncementEmailProps {
  venueName: string;
  message: string;
}

export function AnnouncementEmail({
  venueName,
  message,
}: AnnouncementEmailProps): React.ReactElement {
  return (
    <EmailShell
      lang="en"
      dir="ltr"
      brand={platformBrand(BRAND.name)}
      title={`A note from ${BRAND.name}`}
      footer={`— The ${BRAND.name} team`}
    >
      <p style={styles.eyebrow}>{BRAND.name}</p>
      <h1 style={styles.h1}>Hi {venueName},</h1>
      {message.split(/\n{2,}/).map((para) => (
        <p key={para.slice(0, 40)} style={{ margin: "0 0 12px" }}>
          {para}
        </p>
      ))}
    </EmailShell>
  );
}
