import { withExponentialBackoff, sleep } from "@/lib/fetcher/backoff";
import { buildMockSnapshot } from "@/lib/fetcher/mock";
import { parsePublicHtml } from "@/lib/parser";
import type { TrademarkSnapshot } from "@/lib/types";

const DEFAULT_TIMEOUT_MS = 12_000;
const INTER_CALL_DELAY_MS = 350;

/** Public Marcanet/SIGA-style lookup URLs (best-effort; often rate-limited). */
const CANDIDATE_URLS = (expediente: string) => [
  `https://marcanet.impi.gob.mx/marcanet/vistas/common/datos/bsqExpedienteCompleto.pgi?expediente=${expediente}`,
  `https://siga.impi.gob.mx/newsiga/rest/expediente/${expediente}`,
];

export type FetchMode = "auto" | "live" | "mock";

export function getFetchMode(): FetchMode {
  const raw = (process.env.IMPI_FETCH_MODE ?? "auto").toLowerCase();
  if (raw === "live" || raw === "mock" || raw === "auto") return raw;
  return "auto";
}

function looksBlocked(body: string, status: number): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  const lower = body.toLowerCase();
  return (
    lower.includes("captcha") ||
    lower.includes("cloudflare") ||
    lower.includes("access denied") ||
    lower.includes("just a moment") ||
    (body.length < 80 && status >= 400)
  );
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
          "IMPI-Monitor/0.1 (+local; respectful public lookup; contact practice)",
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

async function tryLiveFetch(expediente: string): Promise<TrademarkSnapshot> {
  let lastError: Error | null = null;

  for (const url of CANDIDATE_URLS(expediente)) {
    await sleep(INTER_CALL_DELAY_MS);
    try {
      const result = await withExponentialBackoff(async () => {
        const response = await fetchWithTimeout(url);
        if (looksBlocked(response.body, response.status)) {
          throw new Error(
            `Portal blocked or rate-limited (${response.status}) for ${url}`,
          );
        }
        if (response.status >= 400) {
          throw new Error(`HTTP ${response.status} from ${url}`);
        }
        const parsed = parsePublicHtml(expediente, response.body, response.contentType);
        if (!parsed) {
          throw new Error(`Unable to parse public response from ${url}`);
        }
        return { ...parsed, source: "live" as const };
      });
      return result;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Live Marcanet/SIGA fetch failed");
}

export async function fetchTrademarkSnapshot(
  expediente: string,
): Promise<TrademarkSnapshot> {
  const mode = getFetchMode();

  if (mode === "mock") {
    return buildMockSnapshot(expediente);
  }

  if (mode === "live") {
    return tryLiveFetch(expediente);
  }

  try {
    return await tryLiveFetch(expediente);
  } catch {
    // Offline / captcha / rate-limit: keep the product demoable.
    return buildMockSnapshot(expediente);
  }
}
