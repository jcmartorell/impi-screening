import { jsonPrivate, requireViewer } from "@/lib/auth";
import { runDailyExpiryScanForOwner } from "@/lib/daily-scan";
import {
  buildDailyScanSetCookie,
  hydrateDailyScanFromCookie,
  readDailyScanCookieFromRequest,
} from "@/lib/daily-scan-cookie";
import { hydratePortfolioForRequest, portfolioSetCookie } from "@/lib/portfolio";
import {
  getOwnerSettings,
  listDailyScanHits,
  listExpiringCombined,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function hydrateAll(ownerKey: string, request: Request) {
  hydratePortfolioForRequest(ownerKey, request);
  hydrateDailyScanFromCookie(ownerKey, readDailyScanCookieFromRequest(request));
}

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  hydrateAll(viewer.ownerKey, request);
  const settings = getOwnerSettings(viewer.ownerKey);
  const days = settings.dailyScan.daysWindow || 30;

  return jsonPrivate(
    {
      config: settings.dailyScan,
      configUpdatedAt: settings.dailyScanUpdatedAt,
      lastRunAt: settings.dailyScanLastRunAt,
      usingDefault: settings.dailyScanUsingDefault,
      hits: listDailyScanHits(viewer.ownerKey, days),
      combined: listExpiringCombined(viewer.ownerKey, days),
      days,
    },
    {
      setCookies: [
        portfolioSetCookie(viewer.ownerKey),
        buildDailyScanSetCookie(viewer.ownerKey),
      ],
    },
  );
}

/** Manual “Ejecutar ahora” for the signed-in owner. */
export async function POST(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  hydrateAll(viewer.ownerKey, request);

  const result = await runDailyExpiryScanForOwner(viewer.ownerKey, {
    sendEmail: true,
  });

  return jsonPrivate(
    {
      ok: result.ok,
      keywords: result.keywords,
      rawHits: result.rawHits,
      nearExpiry: result.nearExpiry,
      newForEmail: result.newForEmail,
      emailed: result.emailed,
      emailMode: result.emailMode,
      error: result.error,
      hits: result.hits,
      lastRunAt: getOwnerSettings(viewer.ownerKey).dailyScanLastRunAt,
    },
    {
      setCookies: [
        portfolioSetCookie(viewer.ownerKey),
        buildDailyScanSetCookie(viewer.ownerKey),
      ],
    },
  );
}
