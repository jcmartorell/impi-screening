import { getFetchMode } from "@/lib/fetcher/marcanet";
import { MOCK_CATALOG, buildMockSnapshot } from "@/lib/fetcher/mock";
import {
  searchFichas,
  type SearchFilters,
  type SearchHit,
} from "@/lib/fetcher/siga-tugaceta";

export type SearchResponse = {
  ok: boolean;
  mode: ReturnType<typeof getFetchMode>;
  hits: SearchHit[];
  rawCount: number;
  blocked?: string;
  source: "live" | "mock";
  warning?: string;
};

function mockSearch(filters: SearchFilters): SearchResponse {
  const q = filters.keyword.trim().toLowerCase();
  const classFilter = (filters.classNice ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const hits: SearchHit[] = [];
  for (const [expediente, seed] of Object.entries(MOCK_CATALOG)) {
    const hay = `${expediente} ${seed.markName} ${seed.owner} ${seed.classNice}`.toLowerCase();
    if (q && !hay.includes(q) && !expediente.includes(q.replace(/\D/g, ""))) {
      continue;
    }
    if (classFilter.length) {
      const classes = seed.classNice.split(/[,\s]+/).map((c) => c.trim());
      if (!classFilter.some((c) => classes.includes(c))) continue;
    }
    const snap = buildMockSnapshot(expediente);
    hits.push({
      fichaId: Number(expediente) || hits.length + 1,
      expediente,
      markName: snap.markName,
      owner: snap.owner,
      classNice: snap.classNice,
      statusLabel: snap.statusLabel,
      gaceta: "Catálogo mock",
      seccion: snap.statusLabel,
      publicationDate: snap.lastMovementDate,
      registro: null,
      grantDate: snap.grantDate,
      rawDatos: {
        Expediente: expediente,
        Denominación: snap.markName,
        Titular: snap.owner,
        Clase: snap.classNice,
        Vigencia: snap.expiryDate ?? "",
        "Fecha de Concesión": snap.grantDate ?? "",
      },
      source: "mock",
    });
  }

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  return {
    ok: true,
    mode: "mock",
    hits: hits.slice(0, limit),
    rawCount: hits.length,
    source: "mock",
    warning:
      "IMPI_FETCH_MODE=mock — resultados del catálogo de muestra, no del portal.",
  };
}

export async function runTrademarkSearch(
  filters: SearchFilters,
): Promise<SearchResponse> {
  const mode = getFetchMode();
  if (mode === "mock") return mockSearch(filters);

  try {
    const result = await searchFichas(filters);
    if (result.blocked) {
      return {
        ok: false,
        mode,
        hits: [],
        rawCount: 0,
        blocked: result.blocked,
        source: "live",
      };
    }
    return {
      ok: true,
      mode,
      hits: result.hits,
      rawCount: result.rawCount,
      source: "live",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      mode,
      hits: [],
      rawCount: 0,
      blocked: message,
      source: "live",
    };
  }
}

export function hitsToCsv(hits: SearchHit[]): string {
  const headers = [
    "fichaId",
    "expediente",
    "markName",
    "owner",
    "classNice",
    "statusLabel",
    "gaceta",
    "seccion",
    "publicationDate",
    "registro",
    "grantDate",
    "source",
  ];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const h of hits) {
    const row: Record<string, unknown> = {
      fichaId: h.fichaId,
      expediente: h.expediente,
      markName: h.markName,
      owner: h.owner,
      classNice: h.classNice,
      statusLabel: h.statusLabel,
      gaceta: h.gaceta,
      seccion: h.seccion,
      publicationDate: h.publicationDate,
      registro: h.registro,
      grantDate: h.grantDate,
      source: h.source,
    };
    lines.push(headers.map((key) => escape(row[key])).join(","));
  }
  return lines.join("\n");
}
