/** Hard caps and refresh throttles for portfolio APIs. */

export const MAX_TRACKED_MARKS_PER_OWNER = 50;
export const MAX_HISTORY_PER_MARK = 25;
export const MAX_NOTIFICATIONS_PER_OWNER = 100;
export const MAX_MARKS_PER_REFRESH = 40;

/** Full-portfolio refresh cooldown per owner. */
export const FULL_REFRESH_COOLDOWN_MS = 20_000;
/** Max refresh actions (single or full) per owner per rolling window. */
export const REFRESH_WINDOW_MS = 60_000;
export const MAX_REFRESHES_PER_WINDOW = 8;
/** Minimum delay between outbound portal attempts (live mode). */
export const PORTAL_CALL_GAP_MS = 500;

type Bucket = {
  fullRefreshAt: number;
  events: number[];
};

const buckets = new Map<string, Bucket>();

function bucket(ownerKey: string): Bucket {
  let b = buckets.get(ownerKey);
  if (!b) {
    b = { fullRefreshAt: 0, events: [] };
    buckets.set(ownerKey, b);
  }
  return b;
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; status: 429; error: string; retryAfterSec: number };

export function assertRefreshAllowed(
  ownerKey: string,
  kind: "single" | "full",
): RateLimitResult {
  const now = Date.now();
  const b = bucket(ownerKey);
  b.events = b.events.filter((t) => now - t < REFRESH_WINDOW_MS);

  if (b.events.length >= MAX_REFRESHES_PER_WINDOW) {
    const oldest = b.events[0] ?? now;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((REFRESH_WINDOW_MS - (now - oldest)) / 1000),
    );
    return {
      ok: false,
      status: 429,
      error: "Demasiadas actualizaciones. Espera un momento.",
      retryAfterSec,
    };
  }

  if (kind === "full") {
    const since = now - b.fullRefreshAt;
    if (b.fullRefreshAt > 0 && since < FULL_REFRESH_COOLDOWN_MS) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((FULL_REFRESH_COOLDOWN_MS - since) / 1000),
      );
      return {
        ok: false,
        status: 429,
        error: "Cartera recién actualizada. Espera antes de refrescar de nuevo.",
        retryAfterSec,
      };
    }
  }

  b.events.push(now);
  if (kind === "full") b.fullRefreshAt = now;
  return { ok: true };
}
