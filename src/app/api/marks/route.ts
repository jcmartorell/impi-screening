import { jsonPrivate, requireViewer } from "@/lib/auth";
import { getFetchMode } from "@/lib/fetcher/marcanet";
import { MAX_TRACKED_MARKS_PER_OWNER, assertRefreshAllowed } from "@/lib/limits";
import {
  hydratePortfolioForRequest,
  portfolioSetCookie,
} from "@/lib/portfolio";
import { listTrackedMarks, upsertTrackedMark } from "@/lib/store";
import { refreshExpediente } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  hydratePortfolioForRequest(viewer.ownerKey, request);
  const marks = listTrackedMarks(viewer.ownerKey);
  return jsonPrivate(
    {
      marks,
      count: marks.length,
      max: MAX_TRACKED_MARKS_PER_OWNER,
      viewer: { name: viewer.name, simulated: viewer.simulated },
      persist: "cookie",
    },
    { setCookies: [portfolioSetCookie(viewer.ownerKey)] },
  );
}

export async function POST(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  hydratePortfolioForRequest(viewer.ownerKey, request);

  let body: {
    expediente?: string;
    clientLabel?: string;
    notes?: string;
    /** Soft restore from client localStorage — no live SIGA fetch. */
    restore?: Array<{
      expediente?: string;
      clientLabel?: string;
      notes?: string;
      current?: unknown;
      trackedAt?: string;
      lastRefreshedAt?: string | null;
    }>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonPrivate({ error: "JSON inválido" }, { status: 400 });
  }

  if (Array.isArray(body.restore)) {
    let restored = 0;
    for (const row of body.restore.slice(0, MAX_TRACKED_MARKS_PER_OWNER)) {
      const digits = String(row.expediente ?? "").replace(/\D/g, "");
      if (!/^\d{7}$/.test(digits)) continue;
      const result = upsertTrackedMark({
        ownerKey: viewer.ownerKey,
        expediente: digits,
        clientLabel: row.clientLabel?.trim() || undefined,
        notes: row.notes?.trim() || undefined,
        current:
          row.current && typeof row.current === "object"
            ? (row.current as never)
            : undefined,
        trackedAt: row.trackedAt,
        lastRefreshedAt: row.lastRefreshedAt,
        enforceCap: true,
      });
      if (!("error" in result)) restored += 1;
    }
    const marks = listTrackedMarks(viewer.ownerKey);
    return jsonPrivate(
      {
        ok: true,
        restored,
        marks,
        count: marks.length,
        max: MAX_TRACKED_MARKS_PER_OWNER,
        persist: "cookie",
      },
      { setCookies: [portfolioSetCookie(viewer.ownerKey)] },
    );
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

  const setCookies = [portfolioSetCookie(viewer.ownerKey)];

  if (!result.ok) {
    // Still persist the placeholder track so Cartera survives cold starts.
    return jsonPrivate({ ...result, mode, persist: "cookie" }, {
      status: 502,
      setCookies,
    });
  }

  return jsonPrivate(
    { ...result, mode, persist: "cookie" },
    { status: 201, setCookies },
  );
}
