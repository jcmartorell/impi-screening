import { authorizeCronRequest } from "@/lib/cron-auth";
import { runDailyExpiryScanForCron } from "@/lib/daily-scan";
import { jsonPrivate } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily TuGaceta scan for configured filters → near-expiry ≤ N days.
 * Vercel Cron → /api/cron/daily-scan
 */
async function handle(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return jsonPrivate({ error: auth.error }, { status: auth.status });
  }

  const owners = await runDailyExpiryScanForCron();
  const summary = {
    ok: true,
    at: new Date().toISOString(),
    owners: owners.map((o) => ({
      ownerKey: o.ownerKey,
      ok: o.ok,
      keywords: o.keywords,
      rawHits: o.rawHits,
      nearExpiry: o.nearExpiry,
      newForEmail: o.newForEmail,
      emailed: o.emailed,
      emailMode: o.emailMode,
      error: o.error,
    })),
  };
  console.info("[impi-cron-daily-scan]", JSON.stringify(summary));
  return jsonPrivate(summary);
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
