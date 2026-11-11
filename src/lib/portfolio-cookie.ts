import { DEFAULT_ALERT_EMAIL } from "@/lib/alert-defaults";
import type { TrackedMark, TrademarkSnapshot } from "@/lib/types";
import {
  getOwnerSettings,
  getTrackedMark,
  listTrackedMarks,
  setOwnerAlertEmail,
  upsertTrackedMark,
} from "@/lib/store";

/** Durable browser cookie — survives Vercel /tmp SQLite ephemerality. */
export const PORTFOLIO_COOKIE = "impi_portfolio_v1";

const COOKIE_MAX_BYTES = 3500;
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 400; // ~13 months

type CookieMark = {
  e: string;
  cl: string;
  n: string;
  ta: string;
  lr: string | null;
  c: TrademarkSnapshot | null;
};

type PortfolioCookiePayload = {
  v: 1;
  ok: string;
  m: CookieMark[];
  ae: string;
  aeSet?: boolean;
};

export type PortfolioCookieState = {
  ownerKey: string;
  marks: TrackedMark[];
  alertEmail: string;
  /** True when the user explicitly saved alert email (incl. empty). */
  alertEmailSet: boolean;
};

function slimSnapshot(
  snapshot: TrademarkSnapshot | null,
): TrademarkSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    owner: (snapshot.owner ?? "").slice(0, 120),
    movements: (snapshot.movements ?? []).slice(0, 2).map((mov) => ({
      ...mov,
      description: (mov.description ?? "").slice(0, 140),
    })),
  };
}

function toCookieMark(mark: TrackedMark): CookieMark {
  return {
    e: mark.expediente,
    cl: mark.clientLabel ?? "",
    n: mark.notes ?? "",
    ta: mark.trackedAt,
    lr: mark.lastRefreshedAt,
    c: slimSnapshot(mark.current),
  };
}

function fromCookieMark(row: CookieMark): TrackedMark {
  return {
    expediente: row.e,
    clientLabel: row.cl ?? "",
    notes: row.n ?? "",
    trackedAt: row.ta,
    lastRefreshedAt: row.lr ?? null,
    current: row.c ?? null,
  };
}

function encodePayload(payload: PortfolioCookiePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(raw: string): PortfolioCookiePayload | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const data = JSON.parse(json) as PortfolioCookiePayload;
    if (data?.v !== 1 || typeof data.ok !== "string" || !Array.isArray(data.m)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function fitPayload(payload: PortfolioCookiePayload): string {
  let encoded = encodePayload(payload);
  if (Buffer.byteLength(encoded, "utf8") <= COOKIE_MAX_BYTES) return encoded;

  const marks = payload.m.map((m) => ({ ...m }));
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    if (marks[i].c) {
      marks[i] = { ...marks[i], c: null };
      payload = { ...payload, m: marks };
      encoded = encodePayload(payload);
      if (Buffer.byteLength(encoded, "utf8") <= COOKIE_MAX_BYTES) return encoded;
    }
  }

  while (marks.length > 1) {
    marks.pop();
    payload = { ...payload, m: marks };
    encoded = encodePayload(payload);
    if (Buffer.byteLength(encoded, "utf8") <= COOKIE_MAX_BYTES) return encoded;
  }
  return encoded;
}

export function parsePortfolioCookieHeader(
  cookieHeader: string | null | undefined,
): PortfolioCookieState | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(/;\s*/);
  const match = parts.find((p) => p.startsWith(`${PORTFOLIO_COOKIE}=`));
  if (!match) return null;
  const raw = match.slice(PORTFOLIO_COOKIE.length + 1);
  if (!raw) return null;
  return parsePortfolioCookieValue(raw);
}

export function parsePortfolioCookieValue(
  raw: string | undefined | null,
): PortfolioCookieState | null {
  if (!raw) return null;
  const payload = decodePayload(raw);
  if (!payload) return null;
  return {
    ownerKey: payload.ok,
    marks: payload.m.map(fromCookieMark),
    alertEmail: typeof payload.ae === "string" ? payload.ae : "",
    alertEmailSet: Boolean(payload.aeSet),
  };
}

/**
 * Write cookie marks + alert email into the process-local SQLite so list*
 * helpers work even on a cold Vercel instance.
 */
export function hydrateStoreFromCookie(
  ownerKey: string,
  state: PortfolioCookieState | null,
): void {
  if (!state || state.ownerKey !== ownerKey) return;

  for (const mark of state.marks) {
    const digits = mark.expediente.replace(/\D/g, "");
    if (!/^\d{7}$/.test(digits)) continue;
    const existing = getTrackedMark(ownerKey, digits);
    const cookieFetched = mark.current?.fetchedAt
      ? Date.parse(mark.current.fetchedAt)
      : 0;
    const existingFetched = existing?.current?.fetchedAt
      ? Date.parse(existing.current.fetchedAt)
      : 0;
    const preferExistingSnapshot =
      Boolean(existing?.current) && existingFetched >= cookieFetched;

    upsertTrackedMark({
      ownerKey,
      expediente: digits,
      clientLabel: mark.clientLabel || existing?.clientLabel,
      notes: mark.notes || existing?.notes,
      current: preferExistingSnapshot ? existing!.current : mark.current,
      lastRefreshedAt: preferExistingSnapshot
        ? existing!.lastRefreshedAt
        : mark.lastRefreshedAt,
      trackedAt: existing?.trackedAt ?? mark.trackedAt,
      enforceCap: false,
    });
  }

  if (state.alertEmailSet) {
    const current = getOwnerSettings(ownerKey);
    if (current.usingDefault || current.alertEmail !== state.alertEmail) {
      setOwnerAlertEmail(ownerKey, state.alertEmail);
    }
  }
}

export function buildPortfolioSetCookie(ownerKey: string): string {
  const settings = getOwnerSettings(ownerKey);
  const marks = listTrackedMarks(ownerKey).map(toCookieMark);
  const alertEmailSet = !settings.usingDefault;
  const alertEmail = settings.usingDefault
    ? DEFAULT_ALERT_EMAIL
    : settings.alertEmail;

  const payload: PortfolioCookiePayload = {
    v: 1,
    ok: ownerKey,
    m: marks,
    ae: alertEmail,
    aeSet: alertEmailSet,
  };
  const value = fitPayload(payload);
  const secure =
    process.env.VERCEL === "1" || process.env.NODE_ENV === "production"
      ? "; Secure"
      : "";
  return `${PORTFOLIO_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; SameSite=Lax; HttpOnly${secure}`;
}

/** Effective alert destination (respects default until user saves). */
export function resolveAlertEmail(ownerKey: string): string {
  return getOwnerSettings(ownerKey).alertEmail;
}

export function readPortfolioCookieFromRequest(
  request: Request,
): PortfolioCookieState | null {
  return parsePortfolioCookieHeader(request.headers.get("cookie"));
}

export { DEFAULT_ALERT_EMAIL };
