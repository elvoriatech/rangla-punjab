import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getVenueForUser } from "@/lib/venue-service";
import { resolveReportRange } from "@/lib/report-range";
import { getVenueReport } from "@/lib/report-service";
import { renderReportPdf } from "@/lib/report-pdf";

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

  const pdf = await renderReportPdf(report);
  const filename = `statement-${report.venue.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${range.fromInput}-to-${range.toInput}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
