import Content, { meta } from "@/content/legal/accessibility.mdx";
import { LegalLayout } from "../_components/legal-layout";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `${meta.title} — ${BRAND.name}` };

export default function AccessibilityPage(): React.ReactElement {
  return (
    <LegalLayout
      title={meta.title}
      lastUpdated={meta.lastUpdated}
      currentPath="/legal/accessibility"
    >
      <Content />
    </LegalLayout>
  );
}
