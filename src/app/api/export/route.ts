import { jsonPrivate, requireViewer } from "@/lib/auth";
import type { SearchHit } from "@/lib/fetcher/siga-tugaceta";
import { hitsToCsv } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EXPORT = 500;

export async function POST(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  let body: { format?: string; hits?: SearchHit[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonPrivate({ error: "JSON inválido" }, { status: 400 });
  }

  const format = String(body.format ?? "json").toLowerCase();
  const hits = Array.isArray(body.hits) ? body.hits.slice(0, MAX_EXPORT) : [];
  if (!hits.length) {
    return jsonPrivate(
      { error: "Selecciona al menos un resultado para exportar" },
      { status: 400 },
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const csv = hitsToCsv(hits);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="impi-busqueda-${stamp}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (format === "json") {
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        count: hits.length,
        viewer: viewer.name,
        hits,
      },
      null,
      2,
    );
    return new Response(payload, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="impi-busqueda-${stamp}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return jsonPrivate(
    { error: "format debe ser csv o json" },
    { status: 400 },
  );
}
