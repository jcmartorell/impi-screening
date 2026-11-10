import { jsonPrivate, requireViewer } from "@/lib/auth";
import { assertRefreshAllowed } from "@/lib/limits";
import { refreshAllTracked, refreshExpediente } from "@/lib/refresh";
import { getFetchMode } from "@/lib/fetcher/marcanet";
import { getTrackedMark } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  let body: { expediente?: string } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as typeof body;
  } catch {
    return jsonPrivate({ error: "JSON inválido" }, { status: 400 });
  }

  const mode = getFetchMode();
  const kind = body.expediente ? "single" : "full";
  const limit = assertRefreshAllowed(viewer.ownerKey, kind);
  if (!limit.ok) {
    return jsonPrivate(
      { error: limit.error, retryAfterSec: limit.retryAfterSec, mode },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      },
    );
  }

  if (body.expediente) {
    const expediente = String(body.expediente).replace(/\D/g, "");
    const owned = getTrackedMark(viewer.ownerKey, expediente);
    if (!owned) {
      return jsonPrivate(
        { error: "Expediente no está en tu cartera.", mode },
        { status: 404 },
      );
    }
    const result = await refreshExpediente(viewer.ownerKey, expediente);
    return jsonPrivate(
      { mode, results: [result] },
      { status: result.ok ? 200 : 502 },
    );
  }

  const results = await refreshAllTracked(viewer.ownerKey);
  const failed = results.filter((r) => !r.ok).length;
  return jsonPrivate({
    mode,
    count: results.length,
    failed,
    changed: results.filter((r) => r.changed).length,
    results,
  });
}
