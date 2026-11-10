import { NextResponse } from "next/server";
import { refreshAllTracked, refreshExpediente } from "@/lib/refresh";
import { getFetchMode } from "@/lib/fetcher/marcanet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { expediente?: string } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const mode = getFetchMode();

  if (body.expediente) {
    const result = await refreshExpediente(
      String(body.expediente).replace(/\D/g, ""),
    );
    return NextResponse.json({ mode, results: [result] }, { status: result.ok ? 200 : 502 });
  }

  const results = await refreshAllTracked();
  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json({
    mode,
    count: results.length,
    failed,
    changed: results.filter((r) => r.changed).length,
    results,
  });
}
