import { jsonPrivate, requireViewer } from "@/lib/auth";
import {
  normalizeDailyScanConfig,
  type DailyScanConfig,
} from "@/lib/daily-scan-config";
import {
  buildDailyScanSetCookie,
  hydrateDailyScanFromCookie,
  readDailyScanCookieFromRequest,
} from "@/lib/daily-scan-cookie";
import {
  hydratePortfolioForRequest,
  portfolioSetCookie,
} from "@/lib/portfolio";
import {
  getOwnerSettings,
  setOwnerAlertEmail,
  setOwnerDailyScanConfig,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hydrateAll(ownerKey: string, request: Request) {
  hydratePortfolioForRequest(ownerKey, request);
  hydrateDailyScanFromCookie(ownerKey, readDailyScanCookieFromRequest(request));
}

function settingsPayload(ownerKey: string) {
  const settings = getOwnerSettings(ownerKey);
  return {
    alertEmail: settings.alertEmail,
    updatedAt: settings.updatedAt,
    usingDefault: settings.usingDefault,
    emailTransport: describeTransport(),
    dailyScan: settings.dailyScan,
    dailyScanUpdatedAt: settings.dailyScanUpdatedAt,
    dailyScanLastRunAt: settings.dailyScanLastRunAt,
    dailyScanUsingDefault: settings.dailyScanUsingDefault,
  };
}

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  hydrateAll(viewer.ownerKey, request);
  return jsonPrivate(settingsPayload(viewer.ownerKey), {
    setCookies: [
      portfolioSetCookie(viewer.ownerKey),
      buildDailyScanSetCookie(viewer.ownerKey),
    ],
  });
}

export async function PATCH(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  hydrateAll(viewer.ownerKey, request);

  let body: {
    alertEmail?: unknown;
    dailyScan?: Partial<DailyScanConfig>;
  } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as typeof body;
  } catch {
    return jsonPrivate({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.alertEmail !== undefined) {
    if (typeof body.alertEmail !== "string") {
      return jsonPrivate(
        { error: "alertEmail debe ser texto (vacío para desactivar)." },
        { status: 400 },
      );
    }
    const alertEmail = body.alertEmail.trim();
    if (alertEmail && !EMAIL_RE.test(alertEmail)) {
      return jsonPrivate(
        { error: "Correo inválido. Déjalo vacío para no enviar alertas." },
        { status: 400 },
      );
    }
    setOwnerAlertEmail(viewer.ownerKey, alertEmail);
  }

  if (body.dailyScan !== undefined) {
    if (!body.dailyScan || typeof body.dailyScan !== "object") {
      return jsonPrivate(
        { error: "dailyScan debe ser un objeto de filtros." },
        { status: 400 },
      );
    }
    setOwnerDailyScanConfig(
      viewer.ownerKey,
      normalizeDailyScanConfig(body.dailyScan),
    );
  }

  if (body.alertEmail === undefined && body.dailyScan === undefined) {
    return jsonPrivate(
      { error: "Indica alertEmail y/o dailyScan." },
      { status: 400 },
    );
  }

  return jsonPrivate(
    {
      ok: true,
      ...settingsPayload(viewer.ownerKey),
    },
    {
      setCookies: [
        portfolioSetCookie(viewer.ownerKey),
        buildDailyScanSetCookie(viewer.ownerKey),
      ],
    },
  );
}

function describeTransport(): "resend" | "smtp" | "log" {
  if (process.env.RESEND_API_KEY?.trim()) return "resend";
  if (
    process.env.SMTP_HOST?.trim() &&
    process.env.SMTP_USER?.trim() &&
    process.env.SMTP_PASS?.trim()
  ) {
    return "smtp";
  }
  return "log";
}
