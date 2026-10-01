import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getVenueForUser } from "@/lib/venue-service";
import { resolveReportRange } from "@/lib/report-range";
import { getVenueReport } from "@/lib/report-service";
import { renderReportPdf } from "@/lib/report-pdf";
import { readUpload } from "@/lib/image-storage";
import { resizeImage } from "@/lib/image-resize";

/** Venue logo as small PNG bytes for the letterhead; any failure just
 *  means a name-only header. */
async function logoPng(logoKey: string | null | undefined): Promise<Uint8Array | null> {
  if (!logoKey) return null;
  try {
    const original = await readUpload(logoKey);
    if (!original) return null;
    return new Uint8Array(await resizeImage(original, 200, "png"));
  } catch {
    return null;
  }
}

/** Statement PDF — session-authenticated, same range resolution as the page. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) return NextResponse.json({ error: "no_venue" }, { status: 404 });

  const q = req.nextUrl.searchParams;
  const range = resolveReportRange({
    preset: q.get("preset") ?? undefined,
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
  });
  const report = await getVenueReport(userId, venueResult.value.id, range);
  if (!report) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const pdf = await renderReportPdf(report, await logoPng(venueResult.value.branding.logoKey));
  const filename = `statement-${report.venue.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${range.fromInput}-to-${range.toInput}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
