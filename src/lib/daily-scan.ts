import {
  parseKeywordList,
  sectorToIdArea,
  type DailyScanConfig,
} from "@/lib/daily-scan-config";
import { emailDailyExpiryDigest } from "@/lib/email";
import {
  fetchFichaInfo,
  inferExpiryDateFromDatos,
  searchFichas,
  searchHitToSnapshot,
  toIsoDate,
  type SearchHit,
} from "@/lib/fetcher/siga-tugaceta";
import { resolveAlertEmail } from "@/lib/portfolio-cookie";
import {
  getOwnerSettings,
  listDailyScanHits,
  listOwnerKeysWithDailyScanEnabled,
  markDailyScanHitsEmailed,
  replaceDailyScanHits,
  setOwnerDailyScanConfig,
  touchDailyScanLastRun,
  type DailyScanHit,
} from "@/lib/store";
import { readEnvDailyScanConfig } from "@/lib/daily-scan-config";

export type DailyScanOwnerResult = {
  ownerKey: string;
  ok: boolean;
  keywords: number;
  rawHits: number;
  nearExpiry: number;
  newForEmail: number;
  emailed: boolean;
  emailMode?: string;
  capped?: boolean;
  error?: string;
  hits: DailyScanHit[];
  /** Sample near-expiry mark for proof / UI. */
  sample?: {
    expediente: string;
    markName: string;
    expiryDate: string;
    daysLeft: number;
  } | null;
};

function withinDays(isoDate: string, days: number): boolean {
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  const horizon = now + days * 24 * 60 * 60 * 1000;
  return t >= now && t <= horizon;
}

function daysLeftFromIso(isoDate: string): number {
  return Math.ceil(
    (Date.parse(isoDate) - Date.now()) / (24 * 60 * 60 * 1000),
  );
}

function expiryFromHit(
  hit: SearchHit,
  idArea: string,
): string | null {
  const expiry = inferExpiryDateFromDatos(hit.rawDatos ?? {}, {
    grantDate: hit.grantDate,
    registro: hit.registro,
    idArea,
    statusLabel: hit.statusLabel,
    seccion: hit.seccion,
  });
  return expiry ? toIsoDate(expiry) ?? expiry : null;
}

/**
 * Prefer list-row fields (Fecha de Concesión / Renovada Hasta). Only call
 * GetFichaInfo when near-expiry and we still need a denominación.
 */
async function enrichNearExpiryHit(hit: SearchHit): Promise<SearchHit> {
  if (hit.markName && hit.markName.trim()) {
    return hit;
  }
  if (!hit.fichaId) return hit;
  try {
    const detail = await fetchFichaInfo(hit.fichaId);
    if (!detail) return hit;
    return {
      ...hit,
      markName: detail.markName ?? hit.markName,
      owner: detail.owner ?? hit.owner,
      classNice: detail.classNice ?? hit.classNice,
      grantDate: detail.grantDate ?? hit.grantDate,
      registro: detail.registro ?? hit.registro,
      statusLabel: detail.statusLabel ?? hit.statusLabel,
      seccion: detail.seccion || hit.seccion,
      rawDatos: { ...hit.rawDatos, ...detail.rawDatos },
    };
  } catch {
    return hit;
  }
}

/**
 * Run configured TuGaceta searches and keep hits with vigencia ≤ daysWindow.
 */
export async function runDailyExpiryScanForOwner(
  ownerKey: string,
  options?: { config?: DailyScanConfig; sendEmail?: boolean },
): Promise<DailyScanOwnerResult> {
  const settings = getOwnerSettings(ownerKey);
  const config = options?.config ?? settings.dailyScan;
  const keywords = parseKeywordList(config.keywords);
  const sendEmail = options?.sendEmail ?? config.emailDigest;

  if (!config.enabled && !options?.config) {
    return {
      ownerKey,
      ok: true,
      keywords: 0,
      rawHits: 0,
      nearExpiry: 0,
      newForEmail: 0,
      emailed: false,
      error: "Escaneo diario desactivado",
      hits: listDailyScanHits(ownerKey),
      sample: null,
    };
  }

  if (!keywords.length) {
    return {
      ownerKey,
      ok: false,
      keywords: 0,
      rawHits: 0,
      nearExpiry: 0,
      newForEmail: 0,
      emailed: false,
      error: "Configura al menos una palabra clave / marca",
      hits: listDailyScanHits(ownerKey),
      sample: null,
    };
  }

  const idArea = sectorToIdArea(config.sector);
  const previous = new Map(
    listDailyScanHits(ownerKey).map((h) => [h.expediente, h]),
  );
  const byExpediente = new Map<
    string,
    {
      expediente: string;
      markName: string;
      classNice: string;
      expiryDate: string;
      fichaId: number | null;
      snapshot: ReturnType<typeof searchHitToSnapshot>;
      emailed: boolean;
    }
  >();

  let rawHits = 0;
  let anyCapped = false;
  try {
    for (const keyword of keywords) {
      const result = await searchFichas(
        {
          keyword,
          classNice: config.classNice || undefined,
          dateFrom: config.dateFrom || undefined,
          dateTo: config.dateTo || undefined,
          idArea,
          limit: config.limitPerKeyword,
          exhaustPages: true,
        },
        { skipListEnrichment: true },
      );
      if (result.blocked && !result.hits.length) {
        return {
          ownerKey,
          ok: false,
          keywords: keywords.length,
          rawHits,
          nearExpiry: 0,
          newForEmail: 0,
          emailed: false,
          capped: anyCapped,
          error: result.blocked,
          hits: listDailyScanHits(ownerKey),
          sample: null,
        };
      }
      if (result.capped) anyCapped = true;
      rawHits += result.hits.length;

      // Infer expiry from list datos for ALL hits (no 40-cap). GetFichaInfo
      // only for near-expiry rows missing Denominación.
      const nearCandidates: {
        hit: SearchHit;
        expiryDate: string;
        expediente: string;
      }[] = [];
      for (const hit of result.hits) {
        const digits = (
          hit.expediente ||
          hit.registro ||
          hit.rawDatos?.["Registro de Marca"] ||
          hit.rawDatos?.["Registro de Aviso Comercial"] ||
          hit.rawDatos?.["Registro de Nombre Comercial"] ||
          ""
        ).replace(/\D/g, "");
        const expediente =
          digits.length >= 5
            ? digits.length >= 7
              ? digits.slice(0, 7)
              : digits.padStart(7, "0")
            : hit.fichaId
              ? `F${hit.fichaId}`
              : "";
        if (!expediente || byExpediente.has(expediente)) continue;

        const expiryDate = expiryFromHit(hit, idArea);
        if (!expiryDate || !withinDays(expiryDate, config.daysWindow)) continue;
        nearCandidates.push({ hit, expiryDate, expediente });
      }

      // Bound detail fetches so serverless stays within maxDuration.
      const toEnrich = nearCandidates.slice(0, 120);
      for (const { hit, expiryDate, expediente } of toEnrich) {
        if (byExpediente.has(expediente)) continue;

        const enriched = await enrichNearExpiryHit(hit);
        const finalExpiry = expiryFromHit(enriched, idArea) ?? expiryDate;
        if (!withinDays(finalExpiry, config.daysWindow)) continue;

        const snapshot = searchHitToSnapshot(enriched, { idArea });
        snapshot.expediente = expediente;
        snapshot.expiryDate = finalExpiry;
        const prev = previous.get(expediente);
        byExpediente.set(expediente, {
          expediente,
          markName: snapshot.markName,
          classNice: snapshot.classNice,
          expiryDate: finalExpiry,
          fichaId: enriched.fichaId ?? null,
          snapshot,
          emailed: Boolean(prev?.emailed),
        });
      }
    }
  } catch (error) {
    return {
      ownerKey,
      ok: false,
      keywords: keywords.length,
      rawHits,
      nearExpiry: 0,
      newForEmail: 0,
      emailed: false,
      capped: anyCapped,
      error: error instanceof Error ? error.message : String(error),
      hits: listDailyScanHits(ownerKey),
      sample: null,
    };
  }

  const nextHits = [...byExpediente.values()].sort((a, b) =>
    a.expiryDate.localeCompare(b.expiryDate),
  );
  const stored = replaceDailyScanHits(ownerKey, nextHits);
  touchDailyScanLastRun(ownerKey);

  const newForEmail = stored.filter((h) => !h.emailed);
  let emailed = false;
  let emailMode: string | undefined;

  if (sendEmail && config.emailDigest && newForEmail.length) {
    const to = resolveAlertEmail(ownerKey);
    const result = await emailDailyExpiryDigest(to, newForEmail, {
      daysWindow: config.daysWindow,
    });
    if (result && result.ok) {
      markDailyScanHitsEmailed(
        ownerKey,
        newForEmail.map((h) => h.expediente),
      );
      emailed = true;
      emailMode = result.mode;
    } else if (result) {
      emailMode = result.mode;
    }
  }

  const first = stored[0];
  const sample = first
    ? {
        expediente: first.expediente,
        markName: first.markName,
        expiryDate: first.expiryDate,
        daysLeft: daysLeftFromIso(first.expiryDate),
      }
    : null;

  return {
    ownerKey,
    ok: true,
    keywords: keywords.length,
    rawHits,
    nearExpiry: stored.length,
    newForEmail: newForEmail.length,
    emailed,
    emailMode,
    capped: anyCapped,
    hits: listDailyScanHits(ownerKey),
    sample,
  };
}

export async function runDailyExpiryScanForCron(): Promise<
  DailyScanOwnerResult[]
> {
  const owners = new Set(listOwnerKeysWithDailyScanEnabled());
  const envCfg = readEnvDailyScanConfig();
  if (envCfg) {
    owners.add(envCfg.ownerKey);
    // Ensure config exists in SQLite for this cold instance.
    const current = getOwnerSettings(envCfg.ownerKey);
    if (current.dailyScanUsingDefault || !current.dailyScan.enabled) {
      setOwnerDailyScanConfig(envCfg.ownerKey, envCfg.config);
    }
  }

  const results: DailyScanOwnerResult[] = [];
  if (!owners.size) {
    return [
      {
        ownerKey: "(none)",
        ok: true,
        keywords: 0,
        rawHits: 0,
        nearExpiry: 0,
        newForEmail: 0,
        emailed: false,
        error:
          "Sin owners con escaneo diario activo (guarda filtros en Ajustes o IMPI_DAILY_SCAN_CONFIG)",
        hits: [],
        sample: null,
      },
    ];
  }

  for (const ownerKey of owners) {
    results.push(await runDailyExpiryScanForOwner(ownerKey));
  }
  return results;
}
