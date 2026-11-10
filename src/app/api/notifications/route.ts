import { jsonPrivate, requireViewer } from "@/lib/auth";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get("unread") === "1";
  const limit = Number(searchParams.get("limit") ?? "50");
  const notifications = listNotifications(viewer.ownerKey, {
    unreadOnly,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
  });
  return jsonPrivate({
    count: notifications.length,
    unread: notifications.filter((n) => !n.read).length,
    notifications,
  });
}

export async function PATCH(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;

  let body: { id?: string; all?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonPrivate({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.all) {
    const updated = markAllNotificationsRead(viewer.ownerKey);
    return jsonPrivate({ updated });
  }

  if (!body.id || typeof body.id !== "string") {
    return jsonPrivate({ error: "id requerido" }, { status: 400 });
  }

  const ok = markNotificationRead(viewer.ownerKey, body.id);
  if (!ok) {
    return jsonPrivate({ error: "notificación no encontrada" }, { status: 404 });
  }
  return jsonPrivate({ ok: true });
}
