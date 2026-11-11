import { jsonPrivate, requireViewer } from "@/lib/auth";
import {
  hydratePortfolioForRequest,
  portfolioSetCookie,
} from "@/lib/portfolio";
import { getOwnerSettings, setOwnerAlertEmail } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  hydratePortfolioForRequest(viewer.ownerKey, request);
  const settings = getOwnerSettings(viewer.ownerKey);
  return jsonPrivate(
    {
      alertEmail: settings.alertEmail,
      updatedAt: settings.updatedAt,
      usingDefault: settings.usingDefault,
      emailTransport: describeTransport(),
    },
    { setCookies: [portfolioSetCookie(viewer.ownerKey)] },
  );
}

export async function PATCH(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  hydratePortfolioForRequest(viewer.ownerKey, request);

  let body: { alertEmail?: unknown } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as typeof body;
  } catch {
    return jsonPrivate({ error: "JSON inválido" }, { status: 400 });
  }

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

  const settings = setOwnerAlertEmail(viewer.ownerKey, alertEmail);
  return jsonPrivate(
    {
      ok: true,
      alertEmail: settings.alertEmail,
      updatedAt: settings.updatedAt,
      usingDefault: settings.usingDefault,
      emailTransport: describeTransport(),
    },
    { setCookies: [portfolioSetCookie(viewer.ownerKey)] },
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
