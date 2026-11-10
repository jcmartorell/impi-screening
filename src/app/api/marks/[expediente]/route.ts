import { NextResponse } from "next/server";
import { getTrackedMark, listHistory } from "@/lib/store";
import { refreshExpediente } from "@/lib/refresh";
import { buildMockSnapshot } from "@/lib/fetcher/mock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ expediente: string }> };

export async function GET(request: Request, context: Ctx) {
  const { expediente: raw } = await context.params;
  const expediente = raw.replace(/\D/g, "");
  if (!/^\d{7}$/.test(expediente)) {
    return NextResponse.json(
      { error: "expediente debe ser de 7 dígitos" },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get("refresh") === "1";

  if (refresh) {
    const result = await refreshExpediente(expediente);
    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
  }

  const tracked = getTrackedMark(expediente);
  if (tracked?.current) {
    return NextResponse.json({
      tracked: true,
      mark: tracked,
      history: listHistory(expediente, 10),
    });
  }

  // Untracked lookup: return mock/live snapshot without persisting unless refresh asked
  const snapshot = refresh
    ? (await refreshExpediente(expediente)).snapshot
    : buildMockSnapshot(expediente);

  return NextResponse.json({
    tracked: false,
    mark: {
      expediente,
      clientLabel: "",
      notes: "",
      trackedAt: null,
      lastRefreshedAt: snapshot?.fetchedAt ?? null,
      current: snapshot ?? null,
    },
    history: [],
  });
}
