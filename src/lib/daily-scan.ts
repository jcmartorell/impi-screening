import {
  parseKeywordList,
  sectorToIdArea,
  type DailyScanConfig,
} from "@/lib/daily-scan-config";
import { emailDailyExpiryDigest } from "@/lib/email";
import {
  fetchFichaInfo,
  inferExpiryDateFromDatos,
  searchHitToSnapshot,
  toIsoDate,
  type SearchHit,
} from "@/lib/fetcher/siga-tugaceta";
import { resolveAlertEmail } from "@/lib/portfolio-cookie";
import { runTrademarkSearch } from "@/lib/search";
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
  error?: string;
  hits: DailyScanHit[];
};

function withinDays(isoDate: string, days: number): boolean {
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  const horizon = now + days * 24 * 60 * 60 * 1000;
  return t >= now && t <= horizon;
}

async function enrichExpiry(
  hit: SearchHit,
  idArea: string,
): Promise<{ hit: SearchHit; expiryDate: string | null }> {
  let working = hit;
  let expiry = inferExpiryDateFromDatos(hit.rawDatos ?? {}, {
    grantDate: hit.grantDate,
    registro: hit.registro,
    idArea,
    statusLabel: hit.statusLabel,
    seccion: hit.seccion,
  });

  if (!expiry && hit.fichaId) {
    try {
      const detail = await fetchFichaInfo(hit.fichaId);
      if (detail) {
        working = {
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
        expiry = inferExpiryDateFromDatos(working.rawDatos ?? {}, {
          grantDate: working.grantDate,
          registro: working.registro,
          idArea,
          statusLabel: working.statusLabel,
          seccion: working.seccion,
        });
      }
    } catch {
      /* keep list row */
    }
  }

  return { hit: working, expiryDate: expiry ? toIsoDate(expiry) ?? expiry : null };
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
  try {
    for (const keyword of keywords) {
      const result = await runTrademarkSearch({
        keyword,
        classNice: config.classNice || undefined,
        dateFrom: config.dateFrom || undefined,
        dateTo: config.dateTo || undefined,
        idArea,
        limit: config.limitPerKeyword,
      });
      if (!result.ok) {
        return {
          ownerKey,
          ok: false,
          keywords: keywords.length,
          rawHits,
          nearExpiry: 0,
          newForEmail: 0,
          emailed: false,
          error: result.blocked ?? "Búsqueda TuGaceta falló",
          hits: listDailyScanHits(ownerKey),
        };
      }
      rawHits += result.hits.length;

      // Enrich a bounded set so serverless stays within maxDuration.
      const candidates = result.hits.slice(0, Math.min(result.hits.length, 40));
      for (const hit of candidates) {
        const digits = (hit.expediente ?? "").replace(/\D/g, "");
        if (digits.length < 5) continue;
        const expediente =
          digits.length >= 7 ? digits.slice(0, 7) : digits.padStart(7, "0");
        if (byExpediente.has(expediente)) continue;

        const { hit: enriched, expiryDate } = await enrichExpiry(hit, idArea);
        if (!expiryDate || !withinDays(expiryDate, config.daysWindow)) continue;

        const snapshot = searchHitToSnapshot(enriched, { idArea });
        snapshot.expediente = expediente;
        snapshot.expiryDate = expiryDate;
        const prev = previous.get(expediente);
        byExpediente.set(expediente, {
          expediente,
          markName: snapshot.markName,
          classNice: snapshot.classNice,
          expiryDate,
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
      error: error instanceof Error ? error.message : String(error),
      hits: listDailyScanHits(ownerKey),
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

  return {
    ownerKey,
    ok: true,
    keywords: keywords.length,
    rawHits,
    nearExpiry: stored.length,
    newForEmail: newForEmail.length,
    emailed,
    emailMode,
    hits: listDailyScanHits(ownerKey),
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
      },
    ];
  }

  for (const ownerKey of owners) {
    results.push(await runDailyExpiryScanForOwner(ownerKey));
  }
  return results;
}
