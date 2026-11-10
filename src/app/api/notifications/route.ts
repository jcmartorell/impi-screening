import { NextResponse } from "next/server";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get("unread") === "1";
  const limit = Number(searchParams.get("limit") ?? "50");
  const notifications = listNotifications({
    unreadOnly,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50,
  });
  return NextResponse.json({
    count: notifications.length,
    unread: notifications.filter((n) => !n.read).length,
    notifications,
  });
}

export async function PATCH(request: Request) {
  let body: { id?: string; all?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.all) {
    const updated = markAllNotificationsRead();
    return NextResponse.json({ updated });
  }

  if (!body.id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  const ok = markNotificationRead(body.id);
  if (!ok) {
    return NextResponse.json({ error: "notificación no encontrada" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
