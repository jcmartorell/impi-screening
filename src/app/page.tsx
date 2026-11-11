import { cookies, headers } from "next/headers";
import { AlertSettings } from "@/components/dashboard/alert-settings";
import { ExpiringPanel } from "@/components/dashboard/expiring-panel";
import { MarksTable } from "@/components/dashboard/marks-table";
import { NotificationsPanel } from "@/components/dashboard/notifications-panel";
import { PortfolioSync } from "@/components/dashboard/portfolio-sync";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { SearchPanel } from "@/components/dashboard/search-panel";
import { TrackForm } from "@/components/dashboard/track-form";
import { resolveViewer } from "@/lib/auth";
import { getFetchMode } from "@/lib/fetcher/marcanet";
import {
  hydratePortfolioFromCookieValue,
  PORTFOLIO_COOKIE,
} from "@/lib/portfolio";
import {
  getOwnerSettings,
  listExpiringWithin,
  listNotifications,
  listTrackedMarks,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const viewer = await resolveViewer(await headers());

  if (!viewer) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--teal-deep)]">
          Monitor de marcas
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

  // Cookie is the durable source of truth on Vercel (/tmp SQLite is ephemeral).
  const jar = await cookies();
  hydratePortfolioFromCookieValue(
    viewer.ownerKey,
    jar.get(PORTFOLIO_COOKIE)?.value,
  );

  const marks = listTrackedMarks(viewer.ownerKey);
  const notifications = listNotifications(viewer.ownerKey, { limit: 30 });
  const expiringSoon = listExpiringWithin(viewer.ownerKey, 30);
  const expiring = listExpiringWithin(viewer.ownerKey, 120);
  const settings = getOwnerSettings(viewer.ownerKey);
  const mode = getFetchMode();
  const liveMode = mode !== "mock";
  const unread = notifications.filter((n) => !n.read).length;
  const emailTransport: "resend" | "smtp" | "log" = process.env
    .RESEND_API_KEY?.trim()
    ? "resend"
    : process.env.SMTP_HOST?.trim() &&
        process.env.SMTP_USER?.trim() &&
        process.env.SMTP_PASS?.trim()
      ? "smtp"
      : "log";

  return (
    <main className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <PortfolioSync serverCount={marks.length} serverMarks={marks} />
      {viewer.demoMode && !liveMode ? (
        <div
          role="status"
          className="animate-rise rounded-lg border border-[color:var(--brass)]/40 bg-[color:var(--brass)]/15 px-4 py-3 text-sm text-[color:var(--ink)]"
        >
          <strong className="font-semibold">Modo muestra.</strong> Catálogo mock
          activo (`IMPI_FETCH_MODE=mock`). No es identidad Cursor real.
        </div>
      ) : null}

      {viewer.demoMode && liveMode ? (
        <div
          role="status"
          className="animate-rise rounded-lg border border-[color:var(--ink)]/15 bg-white/70 px-4 py-3 text-sm text-[color:var(--ink-soft)]"
        >
          Vista sin identidad Cursor verificada (simulación UI). La cartera
          empieza vacía; la búsqueda usa datos live de SIGA TuGaceta — sin
          catálogo mock.
        </div>
      ) : null}

      <header className="animate-rise flex flex-col gap-6 border-b border-[color:var(--ink)]/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--teal-deep)]">
            <span className="live-dot size-1.5 rounded-full bg-[color:var(--brass)]" />
            Monitor de marcas
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-5xl leading-[0.95] tracking-tight text-[color:var(--ink)] sm:text-6xl">
            IMPI
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-[color:var(--ink-soft)]/90 sm:text-lg">
            Busca en gacetas SIGA y, por separado, monitorea expedientes en
            seguimiento con inbox y alertas por correo.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Sesión: {viewer.name || "usuario"}
            {viewer.demoMode
              ? liveMode
                ? " (UI sin Cursor; live)"
                : " (modo muestra)"
              : viewer.simulated
                ? " (simulada en local)"
                : ""}
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
            Vencen ≤ 30 días
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-3xl text-[color:var(--ink)]">
            {expiringSoon.length}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            ≤120d: {expiring.length} · fetch: {mode}
          </p>
        </div>
      </section>

      <section
        id="busqueda"
        className="animate-rise-delay rounded-xl border border-[color:var(--ink)]/10 bg-white/60 p-4 sm:p-5"
      >
        <div className="mb-3 border-b border-[color:var(--ink)]/8 pb-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--teal-deep)]">
            Búsqueda
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulta gacetas SIGA / TuGaceta. Independiente del monitoreo.
          </p>
        </div>
        <SearchPanel liveMode={liveMode} />
      </section>

      <section
        id="monitoreo"
        className="animate-rise-delay space-y-4 border-t border-[color:var(--ink)]/10 pt-8"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--teal-deep)]">
            Seguimiento / monitoreo
          </p>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Solo expedientes que eliges seguir. El cron y el botón Actualizar
            detectan cambios vs historial y pueden enviar email.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.9fr)]">
          <div className="min-w-0 space-y-6">
            <div>
              <div className="mb-3 flex items-end justify-between gap-3">
                <h2 className="font-[family-name:var(--font-display)] text-2xl text-[color:var(--ink)]">
                  Cartera
                </h2>
                <p className="text-xs text-muted-foreground">
                  {liveMode
                    ? "Vacía hasta que busques y sigas un expediente"
                    : "Estatus actual · último movimiento · vigencia"}
                </p>
              </div>
              <MarksTable marks={marks} />
            </div>
            <ExpiringPanel marks={expiringSoon} days={30} />
            <div className="rounded-xl border border-[color:var(--ink)]/10 bg-white/55 p-4 sm:p-5">
              <h2 className="mb-1 font-[family-name:var(--font-display)] text-lg text-[color:var(--ink)]">
                Seguir por expediente
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Opcional: si ya conoces el número de 7 dígitos, añádelo a
                seguimiento sin pasar por búsqueda.
              </p>
              <TrackForm />
            </div>
            <div className="rounded-xl border border-[color:var(--ink)]/10 bg-white/55 p-4 sm:p-5">
              <h2 className="mb-1 font-[family-name:var(--font-display)] text-lg text-[color:var(--ink)]">
                Ajustes de alertas
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Destino de correo cuando hay modificación en un expediente
                monitoreado.
              </p>
              <AlertSettings
                initialEmail={settings.alertEmail}
                emailTransport={emailTransport}
                usingDefault={settings.usingDefault}
              />
            </div>
          </div>

          <aside className="rounded-xl border border-[color:var(--ink)]/10 bg-white/55 p-4 sm:p-5">
            <NotificationsPanel notifications={notifications} />
          </aside>
        </div>
      </section>

      <footer className="mt-auto border-t border-[color:var(--ink)]/10 pt-6 text-xs text-muted-foreground">
        Live: SIGA TuGaceta API (`:5007`, CSRF). La ruta SPA{" "}
        <code className="font-mono">/newsiga/rest/expediente</code> no es JSON
        usable. Captcha no se resuelve en Vercel; worker local con Playwright
        (`IMPI_USE_PLAYWRIGHT=1` / <code className="font-mono">scripts/siga-worker.mjs</code>
        ). Mock solo con <code className="font-mono">IMPI_FETCH_MODE=mock</code>.
      </footer>
    </main>
  );
}
