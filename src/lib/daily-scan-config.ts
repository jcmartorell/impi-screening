/** Defaults and helpers for the daily near-expiry TuGaceta scan. */

export type DailyScanSector = "marcas" | "patentes" | "proteccion";

export type DailyScanConfig = {
  /** When false, cron skips this owner. */
  enabled: boolean;
  sector: DailyScanSector;
  /** Comma / newline separated keywords (TuGaceta requires at least one). */
  keywords: string;
  /** Nice class filter (comma/space). */
  classNice: string;
  /** Publication date window (yyyy-MM-dd) passed to GetFichas. */
  dateFrom: string;
  dateTo: string;
  /** Horizon for “Vencen ≤ N días”. */
  daysWindow: number;
  /** Send digest email when new near-expiry hits appear. */
  emailDigest: boolean;
  /**
   * Cap per keyword. TuGaceta returns ≤1000/request; daily scan pages per
   * gaceta (and date chunks) up to this limit (~8k for broad marca keywords).
   */
  limitPerKeyword: number;
};

export const DEFAULT_DAILY_SCAN_CONFIG: DailyScanConfig = {
  enabled: false,
  sector: "marcas",
  keywords: "",
  classNice: "",
  dateFrom: "",
  dateTo: "",
  daysWindow: 30,
  emailDigest: true,
  limitPerKeyword: 8000,
};

export function sectorToIdArea(sector: DailyScanSector): string {
  if (sector === "patentes") return "1";
  if (sector === "proteccion") return "3";
  return "2";
}

export function parseKeywordList(raw: string): string[] {
  return String(raw ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function normalizeDailyScanConfig(
  input: Partial<DailyScanConfig> | null | undefined,
): DailyScanConfig {
  const base = { ...DEFAULT_DAILY_SCAN_CONFIG };
  if (!input || typeof input !== "object") return base;

  const sector =
    input.sector === "patentes" ||
    input.sector === "proteccion" ||
    input.sector === "marcas"
      ? input.sector
      : base.sector;

  const daysRaw = Number(input.daysWindow);
  const daysWindow = Number.isFinite(daysRaw)
    ? Math.min(Math.max(Math.floor(daysRaw), 1), 3650)
    : base.daysWindow;

  const limitRaw = Number(input.limitPerKeyword);
  // Legacy default was 80 (pre per-gaceta exhaust); upgrade so saved cookies
  // pick up ~8k capacity without a manual UI edit.
  let limitPerKeyword = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.floor(limitRaw), 1), 12_000)
    : base.limitPerKeyword;
  if (limitPerKeyword === 80) limitPerKeyword = 8000;

  return {
    enabled: Boolean(input.enabled),
    sector,
    keywords: String(input.keywords ?? "").slice(0, 500),
    classNice: String(input.classNice ?? "").slice(0, 80),
    dateFrom: String(input.dateFrom ?? "").slice(0, 32),
    dateTo: String(input.dateTo ?? "").slice(0, 32),
    daysWindow,
    emailDigest: input.emailDigest !== false,
    limitPerKeyword,
  };
}

/** Optional Vercel env JSON for cold-start cron when SQLite is empty. */
export function readEnvDailyScanConfig(): {
  ownerKey: string;
  config: DailyScanConfig;
} | null {
  const raw = process.env.IMPI_DAILY_SCAN_CONFIG?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DailyScanConfig> & {
      ownerKey?: string;
    };
    const ownerKey =
      typeof parsed.ownerKey === "string" && parsed.ownerKey.trim()
        ? parsed.ownerKey.trim()
        : "user:dev::production";
    const config = normalizeDailyScanConfig({ ...parsed, enabled: true });
    if (!parseKeywordList(config.keywords).length) return null;
    return { ownerKey, config };
  } catch {
    console.warn("[impi-daily-scan] IMPI_DAILY_SCAN_CONFIG JSON inválido");
    return null;
  }
}
