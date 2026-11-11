/**
 * Authorize Vercel Cron (or manual) callers.
 * Accepts:
 * - Authorization: Bearer <CRON_SECRET>
 * - x-cron-secret: <CRON_SECRET>
 * - x-vercel-cron: 1 (when CRON_SECRET is unset — Vercel platform header only)
 */
export function authorizeCronRequest(request: Request):
  | { ok: true }
  | { ok: false; status: 401; error: string } {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const headerSecret = request.headers.get("x-cron-secret")?.trim() ?? "";
  const vercelCron = request.headers.get("x-vercel-cron")?.trim() === "1";

  if (secret) {
    if (bearer === secret || headerSecret === secret) {
      return { ok: true };
    }
    return { ok: false, status: 401, error: "Unauthorized cron caller" };
  }

  // No CRON_SECRET configured: only trust Vercel's cron header (or local/dev).
  if (vercelCron) return { ok: true };
  if (process.env.NODE_ENV !== "production") return { ok: true };

  return {
    ok: false,
    status: 401,
    error: "CRON_SECRET required for production cron calls",
  };
}
