import { jsonPrivate, requireViewer } from "@/lib/auth";
import {
  buildDailyScanSetCookie,
  hydrateDailyScanFromCookie,
  readDailyScanCookieFromRequest,
} from "@/lib/daily-scan-cookie";
import { hydratePortfolioForRequest, portfolioSetCookie } from "@/lib/portfolio";
import { getOwnerSettings, listExpiringCombined } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  hydratePortfolioForRequest(viewer.ownerKey, request);
  hydrateDailyScanFromCookie(
    viewer.ownerKey,
    readDailyScanCookieFromRequest(request),
  );

  const { searchParams } = new URL(request.url);
  const settings = getOwnerSettings(viewer.ownerKey);
  const defaultDays = settings.dailyScan.daysWindow || 30;
  const daysRaw = Number(searchParams.get("days") ?? String(defaultDays));
  const days = Number.isFinite(daysRaw)
    ? Math.min(Math.max(Math.floor(daysRaw), 1), 3650)
    : defaultDays;

  const marks = listExpiringCombined(viewer.ownerKey, days);
  return jsonPrivate(
    {
      days,
      count: marks.length,
      marks,
      sources: {
        tracked: marks.filter((m) => m.source === "tracked").length,
        scan: marks.filter((m) => m.source === "scan").length,
      },
    },
    {
      setCookies: [
        portfolioSetCookie(viewer.ownerKey),
        buildDailyScanSetCookie(viewer.ownerKey),
      ],
    },
  );
}
