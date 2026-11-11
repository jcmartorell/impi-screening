/**
 * SIGA TuGaceta API client (https://siga.impi.gob.mx:5007).
 *
 * The path `/newsiga/rest/expediente/{id}` is an Angular SPA shell with
 * reCAPTCHA — not a parseable REST payload. Real public data lives on the
 * TuGaceta API behind CSRF (+ optional reCAPTCHA token).
 *
 * Captcha: many endpoints accept a placeholder `reCaptchaToken` when CSRF is
 * valid. If IMPI starts enforcing tokens, enable Playwright via
 * `IMPI_USE_PLAYWRIGHT=1` (local/worker only — not viable on Vercel serverless).
 */

import { normalizeStatus } from "@/lib/parser";
import { STATUS_LABELS } from "@/lib/types";
import type { TrademarkSnapshot } from "@/lib/types";

export const SIGA_API_BASE =
  process.env.IMPI_SIGA_API_BASE?.trim() || "https://siga.impi.gob.mx:5007";
export const SIGA_ORIGIN = "https://siga.impi.gob.mx";
export const SIGA_RECAPTCHA_SITE_KEY = "6LeRdm0pAAAAAOprsyOxSYwiBsVUmGSMdnCuA-P6";

/** Default Marcas-area gacetas useful for trademark screening. */
export const DEFAULT_MARCA_GACETAS = [1, 35, 37, 40, 30, 36, 18, 81] as const;

export const MARCA_AREA_ID = "2";

export type SigaDato = { descripcion: string; datoTxt: string; orden?: number };

export type SigaFichaHit = {
  fichaId: number;
  areaId?: number;
  ejemplar?: string;
  gaceta: string;
  seccion: string;
  fechaPuestaCirculacion: string;
  imagen?: boolean;
  datos: SigaDato[];
};

export type SearchHit = {
  fichaId: number;
  expediente: string | null;
  markName: string | null;
  owner: string | null;
  classNice: string | null;
  statusLabel: string | null;
  gaceta: string;
  seccion: string;
  publicationDate: string | null;
  registro: string | null;
  grantDate: string | null;
  rawDatos: Record<string, string>;
  source: "live" | "mock";
};

export type SearchFilters = {
  keyword: string;
  /** Nice class number(s), comma/space separated — client-side filter. */
  classNice?: string;
  dateFrom?: string;
  dateTo?: string;
  /** IMPI area id as string; default marcas = "2". */
  idArea?: string;
  /** Gaceta ids; default marca set. */
  idGaceta?: number[];
  limit?: number;
};

type CookieJar = Map<string, string>;

function parseSetCookie(header: string | null, jar: CookieJar): void {
  if (!header) return;
  // Node may join multiple Set-Cookie with comma; split carefully on ", " before next cookie name=
  const parts = header.split(/,(?=\s*[^;=]+=)/);
  for (const part of parts) {
    const pair = part.split(";")[0]?.trim();
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function sigaFetch(
  path: string,
  init: RequestInit & { jar: CookieJar; timeoutMs?: number },
): Promise<{ status: number; body: string; json: unknown }> {
  const { jar, timeoutMs = 25_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(rest.headers);
    headers.set("Origin", SIGA_ORIGIN);
    headers.set("Referer", `${SIGA_ORIGIN}/`);
    headers.set(
      "User-Agent",
      "IMPI-Monitor/0.2 (+respectful public TuGaceta lookup)",
    );
    headers.set("Accept", "application/json");
    if (jar.size) headers.set("Cookie", cookieHeader(jar));
    const xsrf = jar.get("XSRF-TOKEN");
    if (xsrf) headers.set("X-XSRF-TOKEN", xsrf);

    const res = await fetch(`${SIGA_API_BASE}${path}`, {
      ...rest,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });

    // undici: getSetCookie when available
    const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
    if (typeof anyHeaders.getSetCookie === "function") {
      for (const c of anyHeaders.getSetCookie()) parseSetCookie(c, jar);
    } else {
      parseSetCookie(res.headers.get("set-cookie"), jar);
    }

    const body = await res.text();
    let json: unknown = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = null;
    }
    return { status: res.status, body, json };
  } finally {
    clearTimeout(timer);
  }
}

export async function obtainSigaSession(): Promise<CookieJar> {
  const jar: CookieJar = new Map();
  const res = await sigaFetch("/antiforgery/token", {
    method: "GET",
    jar,
    timeoutMs: 12_000,
  });
  if (res.status >= 400 || !jar.get("XSRF-TOKEN")) {
    throw new Error(
      `SIGA CSRF session failed (${res.status}). Portal may be blocking this host.`,
    );
  }
  return jar;
}

/** Optional Playwright path for a real reCAPTCHA v3 token (local/worker). */
export async function obtainRecaptchaToken(
  action = "inicioPage",
): Promise<string | null> {
  if (process.env.IMPI_USE_PLAYWRIGHT !== "1") return null;
  try {
    const mod = await import("@/lib/fetcher/playwright-captcha");
    return await mod.fetchRecaptchaTokenWithPlaywright(action);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[siga] Playwright captcha unavailable:", message);
    return null;
  }
}

async function resolveCaptchaToken(): Promise<string> {
  const fromEnv = process.env.IMPI_RECAPTCHA_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const fromPw = await obtainRecaptchaToken("inicioPage");
  if (fromPw) return fromPw;
  // Placeholder: currently accepted with valid CSRF from many cloud IPs.
  return "impi-monitor-csrf";
}

function toDdMmYyyy(isoOrSlash: string | undefined): string {
  if (!isoOrSlash) return "";
  const s = isoOrSlash.trim();
  if (!s) return "";
  // already dd/MM/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  // yyyy-MM-dd
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function datosMap(datos: SigaDato[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of datos ?? []) {
    if (d?.descripcion && d.datoTxt != null) out[d.descripcion] = d.datoTxt;
  }
  return out;
}

function pick(map: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = map[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  // case-insensitive fallback
  const lower = Object.fromEntries(
    Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

/** Normalize TuGaceta date strings to yyyy-MM-dd when possible. */
export function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const dmY = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmY) return `${dmY[3]}-${dmY[2]}-${dmY[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = Date.parse(s);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function addYearsIso(iso: string, years: number): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/**
 * Prefer explicit vigencia fields; for marcas fall back to concesión (+ 10 años).
 * "Registro de Marca" is often a registration *number*, not a date — ignore non-dates.
 */
export function inferExpiryDateFromDatos(
  raw: Record<string, string>,
  options?: {
    grantDate?: string | null;
    registro?: string | null;
    idArea?: string;
    statusLabel?: string | null;
    seccion?: string | null;
  },
): string | null {
  const explicit = toIsoDate(
    pick(raw, [
      "Vigencia",
      "Fecha de vigencia",
      "Fecha de Vigencia",
      "Vigencia hasta",
      "Fecha de vencimiento",
      "Vencimiento",
      "Fecha vigencia",
    ]),
  );
  if (explicit) return explicit;

  const idArea = String(options?.idArea ?? MARCA_AREA_ID);
  // Mexican trademarks: 10-year term from registration/grant.
  if (idArea === MARCA_AREA_ID) {
    const oficioKind = `${options?.statusLabel ?? ""} ${options?.seccion ?? ""} ${pick(raw, ["Descripción del oficio", "Estatus", "Estado"]) ?? ""}`;
    const concesionOficio = /concesi[oó]n/i.test(oficioKind)
      ? toIsoDate(pick(raw, ["Fecha del oficio"]))
      : null;

    const base =
      toIsoDate(options?.grantDate) ||
      toIsoDate(
        pick(raw, ["Fecha de Concesión", "Fecha de Concesion", "Fecha de Registro"]),
      ) ||
      concesionOficio ||
      // Only if registro looks like a date (not a registry number).
      toIsoDate(options?.registro);
    if (base) return addYearsIso(base, 10);
  }
  return null;
}

export function mapFichaToSearchHit(
  row: SigaFichaHit,
  source: "live" | "mock" = "live",
): SearchHit {
  const raw = datosMap(row.datos);
  const grantDate = pick(raw, ["Fecha de Concesión", "Fecha de Concesion"]);
  const registro = pick(raw, ["Registro de Marca", "Registro"]);
  return {
    fichaId: row.fichaId,
    expediente: pick(raw, ["Expediente"]),
    markName: pick(raw, ["Denominación", "Denominacion", "Marca", "Nombre"]),
    owner: pick(raw, ["Datos del Titular", "Titular", "Solicitante"]),
    classNice: pick(raw, ["Clase", "Clases"]),
    statusLabel: pick(raw, [
      "Descripción del oficio",
      "Estatus",
      "Estado",
      "Resolución",
      "Resolucion",
    ]),
    gaceta: row.gaceta,
    seccion: row.seccion,
    publicationDate: row.fechaPuestaCirculacion || null,
    registro,
    grantDate,
    rawDatos: raw,
    source,
  };
}

export function searchHitToSnapshot(
  hit: SearchHit,
  options?: { idArea?: string },
): TrademarkSnapshot {
  const expediente =
    (hit.expediente ?? "").replace(/\D/g, "") || String(hit.fichaId);
  const statusRaw =
    hit.statusLabel || hit.seccion || hit.gaceta || "desconocida";
  const status = normalizeStatus(statusRaw);
  const expiryDate = inferExpiryDateFromDatos(hit.rawDatos ?? {}, {
    grantDate: hit.grantDate,
    registro: hit.registro,
    idArea: options?.idArea,
    statusLabel: hit.statusLabel,
    seccion: hit.seccion,
  });
  return {
    expediente: expediente.padStart(7, "0").slice(-7),
    markName: hit.markName ?? `Ficha ${hit.fichaId}`,
    owner: hit.owner ?? "Titular no disponible",
    status,
    statusLabel: hit.statusLabel || hit.seccion || STATUS_LABELS[status],
    classNice: hit.classNice ?? "—",
    grantDate: toIsoDate(hit.grantDate) ?? hit.grantDate,
    expiryDate,
    lastMovementDate: hit.publicationDate,
    movements: hit.publicationDate
      ? [
          {
            id: `${hit.fichaId}-pub`,
            date: hit.publicationDate,
            description: `${hit.gaceta} — ${hit.seccion}`,
            kind: "gaceta",
          },
        ]
      : [],
    fetchedAt: new Date().toISOString(),
    source: hit.source,
  };
}

type ApiEnvelope<T> = {
  successed?: boolean;
  message?: string | null;
  data?: T;
  errors?: unknown;
};

function parsePublicationSortKey(date: string | null | undefined): number {
  if (!date) return 0;
  const m = String(date).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return Number(`${m[3]}${m[2]}${m[1]}`);
  const iso = String(date).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Number(`${iso[1]}${iso[2]}${iso[3]}`);
  return 0;
}

async function resolveGacetasForArea(
  idArea: string,
  explicit?: number[],
): Promise<number[]> {
  if (explicit?.length) return explicit;
  if (idArea === MARCA_AREA_ID) return [...DEFAULT_MARCA_GACETAS];
  try {
    const jar = await obtainSigaSession();
    const res = await sigaFetch("/api/Gacetas/getAllGacetas", {
      method: "POST",
      jar,
      headers: { "Content-Type": "application/json" },
      body: "{}",
      timeoutMs: 15_000,
    });
    const envelope = res.json as ApiEnvelope<
      { idGaceta: number; idArea: number }[]
    >;
    const all = Array.isArray(envelope?.data) ? envelope.data : [];
    const ids = all
      .filter((g) => String(g.idArea) === String(idArea))
      .map((g) => g.idGaceta);
    if (ids.length) return ids;
  } catch {
    /* fall through */
  }
  return [...DEFAULT_MARCA_GACETAS];
}

function isCaptchaFailure(status: number, body: string, json: unknown): boolean {
  const msg =
    typeof json === "object" && json && "message" in json
      ? String((json as { message?: string }).message ?? "")
      : "";
  return (
    /captcha|recaptcha/i.test(msg) ||
    /captcha|recaptcha/i.test(body) ||
    (status >= 400 && /captcha|recaptcha/i.test(body + msg))
  );
}

export async function searchFichas(
  filters: SearchFilters,
  options?: { jar?: CookieJar; captchaToken?: string },
): Promise<{ hits: SearchHit[]; blocked?: string; rawCount: number }> {
  const keyword = filters.keyword.trim();
  if (!keyword) {
    return { hits: [], rawCount: 0, blocked: "Indica una palabra o expediente." };
  }

  let jar = options?.jar ?? (await obtainSigaSession());
  let captcha = options?.captchaToken ?? (await resolveCaptchaToken());
  const idArea = String(filters.idArea ?? MARCA_AREA_ID);
  const idGaceta = await resolveGacetasForArea(idArea, filters.idGaceta);

  const bodyBase = {
    busqueda: keyword,
    idArea,
    idGaceta,
    fechaDesde: toDdMmYyyy(filters.dateFrom),
    fechaHasta: toDdMmYyyy(filters.dateTo),
  };

  async function postOnce(token: string) {
    return sigaFetch("/api/BusquedaFicha/GetFichas", {
      method: "POST",
      jar,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...bodyBase, reCaptchaToken: token }),
      timeoutMs: 45_000,
    });
  }

  let res: { status: number; body: string; json: unknown };
  try {
    res = await postOnce(captcha);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/abort|timeout/i.test(message)) {
      return {
        hits: [],
        rawCount: 0,
        blocked: `Timeout consultando SIGA TuGaceta (${SIGA_API_BASE}).`,
      };
    }
    throw error;
  }

  // One honest retry: fresh CSRF + Playwright token when captcha rejected.
  if (
    isCaptchaFailure(res.status, res.body, res.json) ||
    (typeof res.json === "object" &&
      res.json &&
      (res.json as ApiEnvelope<unknown>).successed === false &&
      /captcha|recaptcha/i.test(
        String((res.json as ApiEnvelope<unknown>).message ?? ""),
      ))
  ) {
    try {
      jar = await obtainSigaSession();
      const pw =
        process.env.IMPI_USE_PLAYWRIGHT === "1"
          ? await obtainRecaptchaToken("inicioPage")
          : null;
      if (pw) {
        captcha = pw;
        res = await postOnce(captcha);
      } else if (!options?.captchaToken) {
        // Still retry once with fresh CSRF + placeholder (sometimes enough).
        captcha = await resolveCaptchaToken();
        res = await postOnce(captcha);
      }
    } catch {
      /* keep original res */
    }
  }

  if (res.status === 429) {
    return {
      hits: [],
      rawCount: 0,
      blocked: "SIGA rate-limit (429). Espera ~1 minuto.",
    };
  }
  if (res.status >= 400) {
    const msg =
      typeof res.json === "object" &&
      res.json &&
      "message" in (res.json as object)
        ? String((res.json as { message?: string }).message)
        : res.body.slice(0, 180);
    if (isCaptchaFailure(res.status, res.body, res.json)) {
      return {
        hits: [],
        rawCount: 0,
        blocked:
          "SIGA exige reCAPTCHA válido. En Vercel no se puede resolver captcha server-side; usa worker local (IMPI_USE_PLAYWRIGHT=1 / npm run siga:worker) o IMPI_RECAPTCHA_TOKEN.",
      };
    }
    if (/csrf/i.test(msg)) {
      return {
        hits: [],
        rawCount: 0,
        blocked: `SIGA CSRF rechazado (${res.status}).`,
      };
    }
    return {
      hits: [],
      rawCount: 0,
      blocked: `SIGA GetFichas falló (${res.status}): ${msg}`,
    };
  }

  const envelope = res.json as ApiEnvelope<SigaFichaHit[]> | null;
  if (envelope && envelope.successed === false) {
    const msg = String(envelope.message ?? "error");
    if (/captcha|recaptcha/i.test(msg)) {
      return {
        hits: [],
        rawCount: 0,
        blocked:
          "SIGA respondió error de captcha. Activa worker Playwright (IMPI_USE_PLAYWRIGHT=1) fuera de Vercel.",
      };
    }
    return { hits: [], rawCount: 0, blocked: `SIGA: ${msg}` };
  }

  const rows = Array.isArray(envelope?.data) ? envelope!.data! : [];
  let hits = rows.map((r) => mapFichaToSearchHit(r, "live"));

  const classFilter = (filters.classNice ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (classFilter.length) {
    hits = hits.filter((h) => {
      if (!h.classNice) return false;
      const classes = h.classNice.split(/[,\s]+/).map((c) => c.trim());
      return classFilter.some((c) => classes.includes(c));
    });
  }

  const keywordDigits = keyword.replace(/\D/g, "");
  hits.sort((a, b) => {
    if (keywordDigits.length >= 5) {
      const aExact =
        (a.expediente ?? "").replace(/\D/g, "") === keywordDigits ? 1 : 0;
      const bExact =
        (b.expediente ?? "").replace(/\D/g, "") === keywordDigits ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
    }
    return (
      parsePublicationSortKey(b.publicationDate) -
      parsePublicationSortKey(a.publicationDate)
    );
  });

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  hits = hits.slice(0, limit);

  // Listado GetFichas often omits Denominación/Clase; enrich a few top hits
  // sequentially (shared CSRF jar is not safe for parallel POSTs).
  const toEnrich = hits
    .filter((h) => !h.markName || !h.classNice || h.classNice === "—")
    .slice(0, 6);
  for (const h of toEnrich) {
    try {
      const detail = await fetchFichaInfo(h.fichaId, {
        jar,
        captchaToken: captcha,
      });
      if (!detail) continue;
      h.markName = detail.markName ?? h.markName;
      h.owner = detail.owner ?? h.owner;
      h.classNice = detail.classNice ?? h.classNice;
      h.registro = detail.registro ?? h.registro;
      h.grantDate = detail.grantDate ?? h.grantDate;
      h.statusLabel = detail.statusLabel ?? h.statusLabel;
      h.rawDatos = { ...h.rawDatos, ...detail.rawDatos };
    } catch {
      /* keep list row */
    }
  }

  return { hits, rawCount: rows.length };
}

export async function fetchFichaInfo(
  fichaId: number,
  options?: { jar?: CookieJar; captchaToken?: string },
): Promise<SearchHit | null> {
  const jar = options?.jar ?? (await obtainSigaSession());
  const captcha = options?.captchaToken ?? (await resolveCaptchaToken());
  const res = await sigaFetch("/api/BusquedaFicha/GetFichaInfo", {
    method: "POST",
    jar,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: fichaId, reCaptchaToken: captcha }),
    timeoutMs: 20_000,
  });
  if (res.status >= 400) return null;
  const envelope = res.json as ApiEnvelope<SigaFichaHit & { datos: SigaDato[] }>;
  if (!envelope?.data) return null;
  return mapFichaToSearchHit(
    {
      fichaId: envelope.data.fichaId ?? fichaId,
      gaceta: envelope.data.gaceta ?? "",
      seccion: envelope.data.seccion ?? "",
      fechaPuestaCirculacion: envelope.data.fechaPuestaCirculacion ?? "",
      datos: envelope.data.datos ?? [],
    },
    "live",
  );
}

/**
 * Resolve a trademark snapshot from TuGaceta by expediente number.
 * Prefers the hit whose Expediente field matches exactly.
 */
export async function fetchSnapshotByExpediente(
  expediente: string,
): Promise<TrademarkSnapshot> {
  const digits = expediente.replace(/\D/g, "");
  const jar = await obtainSigaSession();
  const captcha = await resolveCaptchaToken();
  const { hits, blocked } = await searchFichas(
    {
      keyword: digits,
      idArea: MARCA_AREA_ID,
      idGaceta: [...DEFAULT_MARCA_GACETAS],
      limit: 50,
    },
    { jar, captchaToken: captcha },
  );

  if (blocked) {
    throw new Error(blocked);
  }

  const exact = hits.filter(
    (h) => (h.expediente ?? "").replace(/\D/g, "") === digits,
  );
  const pool = (exact.length ? exact : hits).slice().sort(
    (a, b) =>
      parsePublicationSortKey(b.publicationDate) -
      parsePublicationSortKey(a.publicationDate),
  );
  if (!pool.length) {
    throw new Error(
      `TuGaceta: sin fichas para expediente ${digits} (CSRF ok; sin resultados).`,
    );
  }

  // Prefer most recent publicación, then detalle when available.
  const best = pool[0]!;
  let detail: SearchHit | null = null;
  try {
    detail = await fetchFichaInfo(best.fichaId, {
      jar,
      captchaToken: captcha,
    });
  } catch {
    detail = null;
  }
  const hit = detail ?? best;
  const snapshot = searchHitToSnapshot(hit);
  // Keep requested expediente digits (pad to 7 when modern)
  snapshot.expediente =
    digits.length >= 7 ? digits.slice(0, 7) : digits.padStart(7, "0");
  snapshot.source = "live";
  return snapshot;
}

export async function listGacetasForArea(
  idArea: number,
  jar?: CookieJar,
): Promise<{ idGaceta: number; nombre: string; idArea: number }[]> {
  const session = jar ?? (await obtainSigaSession());
  const res = await sigaFetch("/api/Gacetas/getAllGacetas", {
    method: "POST",
    jar: session,
    headers: { "Content-Type": "application/json" },
    body: "{}",
    timeoutMs: 15_000,
  });
  const envelope = res.json as ApiEnvelope<
    { idGaceta: number; nombre: string; idArea: number }[]
  >;
  const all = Array.isArray(envelope?.data) ? envelope.data : [];
  return all.filter((g) => g.idArea === idArea);
}

export async function listGacetasMarcas(): Promise<
  { idGaceta: number; nombre: string; idArea: number }[]
> {
  return listGacetasForArea(2);
}
