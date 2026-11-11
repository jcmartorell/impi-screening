import type { DailyScanConfig } from "@/lib/daily-scan-config";
import {
  DEFAULT_DAILY_SCAN_CONFIG,
  normalizeDailyScanConfig,
} from "@/lib/daily-scan-config";
import {
  getOwnerSettings,
  listDailyScanHits,
  replaceDailyScanHits,
  setOwnerDailyScanConfig,
  type DailyScanHit,
} from "@/lib/store";

/**
 * Separate from portfolio cookie so follow-persist E2E is not disturbed.
 * Holds daily scan filters + last near-expiry hits across Vercel cold starts.
 */
export const DAILY_SCAN_COOKIE = "impi_daily_scan_v1";

const COOKIE_MAX_BYTES = 3200;
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 400;

type CookieHit = {
  e: string;
  n: string;
  c: string;
  x: string;
  f: number | null;
  at: string;
  em: number;
};

type DailyScanCookiePayload = {
  v: 1;
  ok: string;
  cfg: DailyScanConfig;
  cfgSet: boolean;
  hits: CookieHit[];
  runAt: string | null;
};

export type DailyScanCookieState = {
  ownerKey: string;
  config: DailyScanConfig;
  configSet: boolean;
  hits: DailyScanHit[];
  lastRunAt: string | null;
};

function encodePayload(payload: DailyScanCookiePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(raw: string): DailyScanCookiePayload | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const data = JSON.parse(json) as DailyScanCookiePayload;
    if (data?.v !== 1 || typeof data.ok !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

function fitPayload(payload: DailyScanCookiePayload): string {
  let encoded = encodePayload(payload);
  if (Buffer.byteLength(encoded, "utf8") <= COOKIE_MAX_BYTES) return encoded;
  const hits = [...payload.hits];
  while (hits.length > 0) {
    hits.pop();
    payload = { ...payload, hits };
    encoded = encodePayload(payload);
    if (Buffer.byteLength(encoded, "utf8") <= COOKIE_MAX_BYTES) return encoded;
  }
  return encoded;
}

function toCookieHit(hit: DailyScanHit): CookieHit {
  return {
    e: hit.expediente,
    n: (hit.markName || "").slice(0, 80),
    c: (hit.classNice || "").slice(0, 20),
    x: hit.expiryDate,
    f: hit.fichaId,
    at: hit.foundAt,
    em: hit.emailed ? 1 : 0,
  };
}

function fromCookieHit(row: CookieHit): DailyScanHit {
  return {
    expediente: row.e,
    markName: row.n ?? "",
    classNice: row.c ?? "",
    expiryDate: row.x,
    fichaId: row.f ?? null,
    snapshot: null,
    foundAt: row.at,
    emailed: Boolean(row.em),
  };
}

export function parseDailyScanCookieValue(
  raw: string | undefined | null,
): DailyScanCookieState | null {
  if (!raw) return null;
  const payload = decodePayload(raw);
  if (!payload) return null;
  return {
    ownerKey: payload.ok,
    config: normalizeDailyScanConfig(payload.cfg),
    configSet: Boolean(payload.cfgSet),
    hits: Array.isArray(payload.hits) ? payload.hits.map(fromCookieHit) : [],
    lastRunAt: payload.runAt ?? null,
  };
}

export function parseDailyScanCookieHeader(
  cookieHeader: string | null | undefined,
): DailyScanCookieState | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(/;\s*/);
  const match = parts.find((p) => p.startsWith(`${DAILY_SCAN_COOKIE}=`));
  if (!match) return null;
  return parseDailyScanCookieValue(match.slice(DAILY_SCAN_COOKIE.length + 1));
}

export function hydrateDailyScanFromCookie(
  ownerKey: string,
  state: DailyScanCookieState | null,
): void {
  if (!state || state.ownerKey !== ownerKey) return;

  if (state.configSet) {
    const current = getOwnerSettings(ownerKey);
    if (
      current.dailyScanUsingDefault ||
      JSON.stringify(current.dailyScan) !== JSON.stringify(state.config)
    ) {
      setOwnerDailyScanConfig(ownerKey, state.config);
    }
  }

  if (state.hits.length) {
    const existing = listDailyScanHits(ownerKey);
    if (!existing.length) {
      replaceDailyScanHits(
        ownerKey,
        state.hits.map((h) => ({
          expediente: h.expediente,
          markName: h.markName,
          classNice: h.classNice,
          expiryDate: h.expiryDate,
          fichaId: h.fichaId,
          snapshot: null,
          emailed: h.emailed,
        })),
      );
    }
  }
}

export function buildDailyScanSetCookie(ownerKey: string): string {
  const settings = getOwnerSettings(ownerKey);
  const hits = listDailyScanHits(ownerKey).slice(0, 40);
  const payload: DailyScanCookiePayload = {
    v: 1,
    ok: ownerKey,
    cfg: settings.dailyScanUsingDefault
      ? { ...DEFAULT_DAILY_SCAN_CONFIG }
      : settings.dailyScan,
    cfgSet: !settings.dailyScanUsingDefault,
    hits: hits.map(toCookieHit),
    runAt: settings.dailyScanLastRunAt,
  };
  const value = fitPayload(payload);
  const secure =
    process.env.VERCEL === "1" || process.env.NODE_ENV === "production"
      ? "; Secure"
      : "";
  return `${DAILY_SCAN_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; SameSite=Lax; HttpOnly${secure}`;
}

export function readDailyScanCookieFromRequest(
  request: Request,
): DailyScanCookieState | null {
  return parseDailyScanCookieHeader(request.headers.get("cookie"));
}
