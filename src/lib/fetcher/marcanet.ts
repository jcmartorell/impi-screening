import { withExponentialBackoff, sleep } from "@/lib/fetcher/backoff";
import { buildMockSnapshot } from "@/lib/fetcher/mock";
import { parsePublicHtml } from "@/lib/parser";
import {
  fetchSnapshotByExpediente as fetchViaTuGaceta,
} from "@/lib/fetcher/siga-tugaceta";
import type { TrademarkSnapshot } from "@/lib/types";

const DEFAULT_TIMEOUT_MS = 12_000;
const INTER_CALL_DELAY_MS = 350;

/**
 * Legacy public HTML/SPA URLs. `/newsiga/rest/expediente/{id}` is an Angular
 * shell with reCAPTCHA — usually not a parseable expediente payload.
 * Prefer TuGaceta API (:5007) via `fetchViaTuGaceta`.
 */
const CANDIDATE_URLS = (expediente: string) => [
  `https://marcanet.impi.gob.mx/marcanet/vistas/common/datos/bsqExpedienteCompleto.pgi?expediente=${expediente}`,
  `https://siga.impi.gob.mx/newsiga/rest/expediente/${expediente}`,
];

export type FetchMode = "auto" | "live" | "mock";

function isProductionRuntime(): boolean {
  return (
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true" ||
    process.env.NODE_ENV === "production"
  );
}

/**
 * Resolve fetch mode.
 * - Explicit `IMPI_FETCH_MODE` always wins.
 * - On Vercel / production, default to `live` (prefer real portal; fail visibly).
 * - Locally, default to `auto` (try live, surface failure instead of silent mock).
 * - Mock catalog only when `IMPI_FETCH_MODE=mock` (local demos).
 */
export function getFetchMode(): FetchMode {
  const raw = (process.env.IMPI_FETCH_MODE ?? "").trim().toLowerCase();
  if (raw === "live" || raw === "mock" || raw === "auto") return raw;
  return isProductionRuntime() ? "live" : "auto";
}

function classifyPortalFailure(
  body: string,
  status: number,
): "forbidden" | "rate_limit" | "captcha" | "challenge" | null {
  if (status === 429) return "rate_limit";
  if (status === 403) return "forbidden";
  if (status === 503) return "forbidden";
  const lower = body.toLowerCase();
  if (
    lower.includes("just a moment") ||
    lower.includes("cf-challenge") ||
    lower.includes("access denied") ||
    lower.includes("attention required") ||
    (lower.includes("cloudflare") && lower.includes("challenge"))
  ) {
    return "challenge";
  }
  if (
    lower.includes("g-recaptcha") ||
    lower.includes("hcaptcha") ||
    /recaptcha\/api\.js\?render=/.test(lower) ||
    (lower.includes("captcha") &&
      (lower.includes("verify") || lower.includes("challenge")))
  ) {
    return "captcha";
  }
  if (body.length < 80 && status >= 400) return "forbidden";
  return null;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ status: number; body: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/html;q=0.9, */*;q=0.8",
        "User-Agent":
          "IMPI-Monitor/0.2 (+local; respectful public lookup; contact practice)",
        "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
      },
      cache: "no-store",
    });
    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();
    return { status: res.status, body, contentType };
  } finally {
    clearTimeout(timer);
  }
}

async function tryLegacyHtmlFetch(
  expediente: string,
): Promise<TrademarkSnapshot> {
  let lastError: Error | null = null;

  for (const url of CANDIDATE_URLS(expediente)) {
    await sleep(INTER_CALL_DELAY_MS);
    try {
      const result = await withExponentialBackoff(async () => {
        const response = await fetchWithTimeout(url);
        const block = classifyPortalFailure(response.body, response.status);
        if (block === "rate_limit") {
          throw new Error(`Portal rate-limited (429) for ${url}`);
        }
        if (block === "forbidden") {
          throw new Error(
            `Portal forbidden/unavailable (${response.status}) for ${url}`,
          );
        }
        if (block === "challenge") {
          throw new Error(
            `Portal challenge/Cloudflare interstitial (${response.status}) for ${url}`,
          );
        }
        if (response.status >= 400) {
          throw new Error(`HTTP ${response.status} from ${url}`);
        }
        const parsed = parsePublicHtml(
          expediente,
          response.body,
          response.contentType,
        );
        if (!parsed) {
          if (block === "captcha") {
            throw new Error(
              `Portal captcha / no parseable expediente payload (${response.status}) for ${url}`,
            );
          }
          throw new Error(
            `Unable to parse public response (${response.status}, ${response.contentType || "unknown-type"}) from ${url}`,
          );
        }
        return { ...parsed, source: "live" as const };
      });
      return result;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Live Marcanet/SIGA HTML fetch failed");
}

async function tryLiveFetch(expediente: string): Promise<TrademarkSnapshot> {
  const errors: string[] = [];

  // 1) TuGaceta API (CSRF + optional captcha) — real public data path.
  try {
    return await fetchViaTuGaceta(expediente);
  } catch (error) {
    errors.push(
      `TuGaceta: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 2) Legacy HTML / SPA URLs (often captcha shell or DNS fail for Marcanet).
  try {
    return await tryLegacyHtmlFetch(expediente);
  } catch (error) {
    errors.push(
      `HTML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  throw new Error(errors.join(" | "));
}

export async function fetchTrademarkSnapshot(
  expediente: string,
): Promise<TrademarkSnapshot> {
  const mode = getFetchMode();

  // Mock catalog only when explicitly requested (local demos).
  if (mode === "mock") {
    return buildMockSnapshot(expediente);
  }

  // `live` and `auto`: attempt the public portal. Never silently substitute
  // catalog mock for known seed expedientes — prefer a visible failure.
  try {
    return await tryLiveFetch(expediente);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    const prefix =
      mode === "live"
        ? "Consulta live fallida"
        : "Consulta al portal fallida (modo auto; sin fallback mock)";
    throw new Error(`${prefix}: ${message}`);
  }
}
