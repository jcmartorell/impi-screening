import { jsonPrivate, requireViewer } from "@/lib/auth";
import { assertRefreshAllowed } from "@/lib/limits";
import { getTrackedMark, listHistory } from "@/lib/store";
import { refreshExpediente } from "@/lib/refresh";
import {
  fetchTrademarkSnapshot,
  getFetchMode,
} from "@/lib/fetcher/marcanet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ expediente: string }> };

export async function GET(request: Request, context: Ctx) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  const { expediente: raw } = await context.params;
  const expediente = raw.replace(/\D/g, "");
  if (!/^\d{7}$/.test(expediente)) {
    return jsonPrivate(
      { error: "expediente debe ser de 7 dígitos" },
      { status: 400 },
    );
  }

  const mode = getFetchMode();
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get("refresh") === "1";

  if (refresh) {
    const limit = assertRefreshAllowed(viewer.ownerKey, "single");
    if (!limit.ok) {
      return jsonPrivate(
        { error: limit.error, retryAfterSec: limit.retryAfterSec, mode },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSec) },
        },
      );
    }
    const result = await refreshExpediente(viewer.ownerKey, expediente);
    if (!result.ok) {
      return jsonPrivate({ ...result, mode }, { status: 502 });
    }
  }

  const tracked = getTrackedMark(viewer.ownerKey, expediente);
  if (tracked?.current) {
    return jsonPrivate({
      tracked: true,
      mark: tracked,
      history: listHistory(viewer.ownerKey, expediente, 10),
      mode,
    });
  }

  // Untracked lookup: respect fetch mode (live/auto hit Marcanet; mock only if explicit).
  try {
    const snapshot = await fetchTrademarkSnapshot(expediente);
    return jsonPrivate({
      tracked: false,
      mark: {
        expediente,
        clientLabel: "",
        notes: "",
        trackedAt: null,
        lastRefreshedAt: snapshot.fetchedAt,
        current: snapshot,
      },
      history: [],
      mode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonPrivate(
      {
        tracked: false,
        error: message,
        mode,
        source: mode === "mock" ? "mock" : "live",
      },
      { status: 502 },
    );
  }
}
