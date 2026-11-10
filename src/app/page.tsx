import { headers } from "next/headers";
import { getIdentity } from "../../cursor/identity";
import { MarksTable } from "@/components/dashboard/marks-table";
import { NotificationsPanel } from "@/components/dashboard/notifications-panel";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { TrackForm } from "@/components/dashboard/track-form";
import { getFetchMode } from "@/lib/fetcher/marcanet";
import {
  listExpiringWithin,
  listNotifications,
  listTrackedMarks,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const identity = await getIdentity(await headers());

  if (!identity.verified) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--teal-deep)]">
          Monitor post-concesión
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-5xl tracking-tight text-[color:var(--ink)]">
          IMPI
        </h1>
        <p className="text-base text-muted-foreground">
          Inicia sesión con Cursor para ver tu cartera. Sin identidad verificada
          no se exponen expedientes, notas ni notificaciones.
        </p>
      </main>
    );
  }

  const stage = identity.stage === "preview" ? "preview" : "production";
  const ownerKey = `${identity.sub}::${stage}`;
  const marks = listTrackedMarks(ownerKey);
  const notifications = listNotifications(ownerKey, { limit: 30 });
  const expiring = listExpiringWithin(ownerKey, 120);
  const mode = getFetchMode();
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <main className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="animate-rise flex flex-col gap-6 border-b border-[color:var(--ink)]/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--teal-deep)]">
            <span className="live-dot size-1.5 rounded-full bg-[color:var(--brass)]" />
            Monitor post-concesión
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-5xl leading-[0.95] tracking-tight text-[color:var(--ink)] sm:text-6xl">
            IMPI
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-[color:var(--ink-soft)]/90 sm:text-lg">
            Cartera de marcas por expediente: declaración de uso, requerimientos,
            oficios, caducidad y movimientos — con inbox de cambios.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Sesión: {identity.name || "usuario"}
            {identity.simulated ? " (simulada en local)" : ""}
          </p>
        </div>
        <RefreshButton />
      </header>

      <section className="animate-rise-delay grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[color:var(--ink)]/10 bg-white/55 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            En seguimiento
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-3xl text-[color:var(--ink)]">
            {marks.length}
          </p>
        </div>
        <div className="rounded-xl border border-[color:var(--ink)]/10 bg-white/55 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Alertas sin leer
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-3xl text-[color:var(--ink)]">
            {unread}
          </p>
        </div>
        <div className="rounded-xl border border-[color:var(--ink)]/10 bg-white/55 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Vencen ≤ 120 días
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-3xl text-[color:var(--ink)]">
            {expiring.length}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            fetch mode: {mode}
          </p>
        </div>
      </section>

      <section className="animate-rise-delay rounded-xl border border-[color:var(--ink)]/10 bg-white/60 p-4 sm:p-5">
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl text-[color:var(--ink)]">
          Alta de expediente
        </h2>
        <TrackForm />
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.9fr)]">
        <section className="min-w-0">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="font-[family-name:var(--font-display)] text-2xl text-[color:var(--ink)]">
              Cartera
            </h2>
            <p className="text-xs text-muted-foreground">
              Estatus actual · último movimiento · vigencia
            </p>
          </div>
          <MarksTable marks={marks} />
        </section>

        <aside className="rounded-xl border border-[color:var(--ink)]/10 bg-white/55 p-4 sm:p-5">
          <NotificationsPanel notifications={notifications} />
        </aside>
      </div>

      <footer className="mt-auto border-t border-[color:var(--ink)]/10 pt-6 text-xs text-muted-foreground">
        Capas: trigger/refresh → fetcher Marcanet/SIGA (mock fallback) → parser/diff →
        notifier in-app. PASE autenticado, MARCia y WhatsApp quedan fuera de v1.
        Cartera aislada por identidad Cursor; límites de alta y refresh activos.
      </footer>
    </main>
  );
}
