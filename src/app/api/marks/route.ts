import { NextResponse } from "next/server";
import { listTrackedMarks, upsertTrackedMark } from "@/lib/store";
import { refreshExpediente } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const marks = listTrackedMarks();
  return NextResponse.json({ marks, count: marks.length });
}

export async function POST(request: Request) {
  let body: { expediente?: string; clientLabel?: string; notes?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const expediente = String(body.expediente ?? "").replace(/\D/g, "");
  if (!/^\d{7}$/.test(expediente)) {
    return NextResponse.json(
      { error: "expediente debe ser de 7 dígitos" },
      { status: 400 },
    );
  }

  // Ensure row exists before refresh so client label/notes stick
  upsertTrackedMark({
    expediente,
    clientLabel: body.clientLabel?.trim() || undefined,
    notes: body.notes?.trim() || undefined,
  });

  const result = await refreshExpediente(expediente, {
    firstTrack: true,
    clientLabel: body.clientLabel?.trim() || undefined,
    notes: body.notes?.trim() || undefined,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json(result, { status: 201 });
}
