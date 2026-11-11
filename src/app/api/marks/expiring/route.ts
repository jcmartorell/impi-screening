import { jsonPrivate, requireViewer } from "@/lib/auth";
import { hydratePortfolioForRequest } from "@/lib/portfolio";
import { listExpiringWithin } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  hydratePortfolioForRequest(viewer.ownerKey, request);

  const { searchParams } = new URL(request.url);
  const daysRaw = Number(searchParams.get("days") ?? "90");
  const days = Number.isFinite(daysRaw)
    ? Math.min(Math.max(Math.floor(daysRaw), 1), 3650)
    : 90;

  const marks = listExpiringWithin(viewer.ownerKey, days);
  return jsonPrivate({
    days,
    count: marks.length,
    marks,
  });
}
