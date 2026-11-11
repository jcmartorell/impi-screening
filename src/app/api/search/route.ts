import { jsonPrivate, requireViewer } from "@/lib/auth";
import { getFetchMode } from "@/lib/fetcher/marcanet";
import { DEFAULT_MARCA_GACETAS } from "@/lib/fetcher/siga-tugaceta";
import { assertRefreshAllowed } from "@/lib/limits";
import { runTrademarkSearch } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return jsonPrivate({
    mode: getFetchMode(),
    defaults: {
      idArea: "2",
      idGaceta: [...DEFAULT_MARCA_GACETAS],
      sector: "marcas",
    },
    filters: ["keyword", "classNice", "dateFrom", "dateTo", "idGaceta", "limit"],
    notes: [
      "Live search uses SIGA TuGaceta API (:5007) with CSRF session.",
      "If captcha is enforced, set IMPI_USE_PLAYWRIGHT=1 on a worker host (not Vercel).",
      "/newsiga/rest/expediente/{id} is an SPA shell — not used for search.",
    ],
  });
}

export async function POST(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  const limit = assertRefreshAllowed(viewer.ownerKey, "single");
  if (!limit.ok) {
    return jsonPrivate(
      { error: limit.error, retryAfterSec: limit.retryAfterSec },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      },
    );
  }

  let body: {
    keyword?: string;
    nombre?: string;
    classNice?: string;
    clase?: string;
    dateFrom?: string;
    dateTo?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    idGaceta?: number[];
    idArea?: string;
    sector?: string;
    limit?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonPrivate({ error: "JSON inválido" }, { status: 400 });
  }

  const keyword = String(body.keyword ?? body.nombre ?? "").trim();
  if (!keyword) {
    return jsonPrivate(
      { error: "keyword / nombre es requerido" },
      { status: 400 },
    );
  }

  const idArea =
    body.idArea ??
    (body.sector === "patentes"
      ? "1"
      : body.sector === "proteccion"
        ? "3"
        : "2");

  const result = await runTrademarkSearch({
    keyword,
    classNice: body.classNice ?? body.clase,
    dateFrom: body.dateFrom ?? body.fechaDesde,
    dateTo: body.dateTo ?? body.fechaHasta,
    idArea,
    idGaceta: body.idGaceta,
    limit: body.limit,
  });

  if (!result.ok) {
    return jsonPrivate(result, { status: 502 });
  }

  return jsonPrivate(result);
}
