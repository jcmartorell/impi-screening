"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppNotification } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function NotificationsPanel({
  notifications,
}: {
  notifications: AppNotification[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unread = notifications.filter((n) => !n.read).length;

  function markAll() {
    startTransition(async () => {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      router.refresh();
    });
  }

  function markOne(id: string) {
    startTransition(async () => {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      router.refresh();
    });
  }

  return (
    <section className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell className="size-4 text-[color:var(--brass)]" />
          <h2 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[color:var(--ink)]">
            Inbox
          </h2>
          {unread > 0 ? (
            <span className="rounded-md bg-[color:var(--ink)] px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--paper)]">
              {unread}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          disabled={pending || unread === 0}
          onClick={markAll}
        >
          <CheckCheck className="size-3.5" />
          Marcar leídas
        </Button>
      </div>

      {notifications.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[color:var(--ink)]/15 bg-white/40 px-4 py-8 text-sm text-muted-foreground">
          Sin notificaciones todavía. Al refrescar la cartera, los cambios de
          estatus y movimientos aparecen aquí.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto pr-1">
          {notifications.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => !n.read && markOne(n.id)}
                className={cn(
                  "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                  n.read
                    ? "border-transparent bg-white/35"
                    : "border-[color:var(--brass)]/35 bg-white/80 shadow-[0_1px_0_rgba(20,36,48,0.04)]",
                )}
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink)]">
                    {n.title}
                  </p>
                  {!n.read ? (
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-[color:var(--brass)]" />
                  ) : null}
                </div>
                <p className="text-sm leading-snug text-muted-foreground">{n.body}</p>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground/80">
                  {formatWhen(n.createdAt)}
                  {n.expediente !== "system" ? ` · ${n.expediente}` : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
