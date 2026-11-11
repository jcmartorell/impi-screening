import { authorizeCronRequest } from "@/lib/cron-auth";
import { getFetchMode } from "@/lib/fetcher/marcanet";
import { refreshAllOwnersForCron } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled portfolio refresh (Vercel Cron → seguimiento list).
 * Does not touch search; only tracked expedientes.
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const mode = getFetchMode();
  const started = Date.now();
  const owners = await refreshAllOwnersForCron();
  const summary = {
    ok: true,
    mode,
    owners: owners.length,
    marks: owners.reduce((n, o) => n + o.count, 0),
    changed: owners.reduce((n, o) => n + o.changed, 0),
    failed: owners.reduce((n, o) => n + o.failed, 0),
    durationMs: Date.now() - started,
    results: owners.map((o) => ({
      ownerKey: o.ownerKey,
      count: o.count,
      changed: o.changed,
      failed: o.failed,
    })),
  };

  console.info("[impi-cron]", JSON.stringify(summary));
  return Response.json(summary, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  return GET(request);
}
