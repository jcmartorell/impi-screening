import { NextResponse } from "next/server";
import { listExpiringWithin } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const daysRaw = Number(searchParams.get("days") ?? "90");
  const days = Number.isFinite(daysRaw)
    ? Math.min(Math.max(Math.floor(daysRaw), 1), 3650)
    : 90;

  const marks = listExpiringWithin(days);
  return NextResponse.json({
    days,
    count: marks.length,
    marks,
  });
}
