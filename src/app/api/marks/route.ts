import { jsonPrivate, requireViewer } from "@/lib/auth";
import { getFetchMode } from "@/lib/fetcher/marcanet";
import { MAX_TRACKED_MARKS_PER_OWNER, assertRefreshAllowed } from "@/lib/limits";
import { listTrackedMarks, upsertTrackedMark } from "@/lib/store";
import { refreshExpediente } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  const marks = listTrackedMarks(viewer.ownerKey);
  return jsonPrivate({
    marks,
    count: marks.length,
    max: MAX_TRACKED_MARKS_PER_OWNER,
    viewer: { name: viewer.name, simulated: viewer.simulated },
  });
}

export async function POST(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  let body: { expediente?: string; clientLabel?: string; notes?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonPrivate({ error: "JSON inválido" }, { status: 400 });
  }

  const expediente = String(body.expediente ?? "").replace(/\D/g, "");
  if (!/^\d{7}$/.test(expediente)) {
    return jsonPrivate(
      { error: "expediente debe ser de 7 dígitos" },
      { status: 400 },
    );
  }

  const limit = assertRefreshAllowed(viewer.ownerKey, "single");
  if (!limit.ok) {
    return jsonPrivate(
      { error: limit.error, retryAfterSec: limit.retryAfterSec },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      },
    );
  }

  const existing = listTrackedMarks(viewer.ownerKey).find(
    (m) => m.expediente === expediente,
  );
  if (!existing) {
    const placeholder = upsertTrackedMark({
      ownerKey: viewer.ownerKey,
      expediente,
      clientLabel: body.clientLabel?.trim() || undefined,
      notes: body.notes?.trim() || undefined,
      enforceCap: true,
    });
    if ("error" in placeholder) {
      return jsonPrivate(
        {
          error: `Límite de ${placeholder.max} expedientes por cartera alcanzado.`,
          max: placeholder.max,
        },
        { status: 413 },
      );
    }
  } else {
    upsertTrackedMark({
      ownerKey: viewer.ownerKey,
      expediente,
      clientLabel: body.clientLabel?.trim() || undefined,
      notes: body.notes?.trim() || undefined,
    });
  }

  const mode = getFetchMode();
  const result = await refreshExpediente(viewer.ownerKey, expediente, {
    firstTrack: !existing,
    clientLabel: body.clientLabel?.trim() || undefined,
    notes: body.notes?.trim() || undefined,
    enforceCap: true,
  });

  if (!result.ok) {
    return jsonPrivate({ ...result, mode }, { status: 502 });
  }

  return jsonPrivate({ ...result, mode }, { status: 201 });
}
