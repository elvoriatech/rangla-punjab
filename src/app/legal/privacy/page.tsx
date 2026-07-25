import Content, { meta } from "@/content/legal/privacy.mdx";
import { LegalLayout } from "../_components/legal-layout";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `${meta.title} — ${BRAND.name}` };

export default function PrivacyPage(): React.ReactElement {
  return (
    <LegalLayout title={meta.title} lastUpdated={meta.lastUpdated} currentPath="/legal/privacy">
      <Content />
    </LegalLayout>
  );
}
