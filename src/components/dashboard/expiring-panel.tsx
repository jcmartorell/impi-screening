import type { TrackedMark } from "@/lib/types";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(
      new Date(value),
    );
  } catch {
    return value;
  }
}

function daysLeft(expiry: string): number {
  return Math.ceil(
    (Date.parse(expiry) - Date.now()) / (24 * 60 * 60 * 1000),
  );
}

export type ExpiringMark = TrackedMark & { source?: "tracked" | "scan" };

export function ExpiringPanel({
  marks,
  days = 30,
}: {
  marks: ExpiringMark[];
  days?: number;
}) {
  const scanCount = marks.filter((m) => m.source === "scan").length;
  const trackedCount = marks.filter((m) => m.source !== "scan").length;

  return (
    <section
      id="vencimientos"
      className="rounded-xl border border-[color:var(--ink)]/10 bg-white/55 p-4 sm:p-5"
    >
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[color:var(--ink)]">
            Vencen ≤ {days} días
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Cartera en seguimiento
            {trackedCount ? ` (${trackedCount})` : ""} + escaneo diario
            TuGaceta
            {scanCount ? ` (${scanCount})` : ""}.
          </p>
        </div>
        <p className="font-[family-name:var(--font-display)] text-2xl text-[color:var(--ink)]">
          {marks.length}
        </p>
      </div>

      {marks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[color:var(--ink)]/15 bg-white/40 px-4 py-6 text-sm text-muted-foreground">
          Ningún expediente vence en los próximos {days} días. Configura el
          escaneo diario abajo o sigue marcas con vigencia conocida.
        </p>
      ) : (
        <ul className="divide-y divide-[color:var(--ink)]/8">
          {marks.map((m) => {
            const expiry = m.current?.expiryDate ?? null;
            const left = expiry ? daysLeft(expiry) : null;
            const fromScan = m.source === "scan";
            return (
              <li
                key={`${m.source ?? "tracked"}-${m.expediente}`}
                className="flex flex-wrap items-baseline justify-between gap-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm text-[color:var(--ink)]">
                    {m.expediente}
                    <span className="ml-2 font-sans text-[10px] uppercase tracking-wide text-muted-foreground">
                      {fromScan ? "escaneo" : "cartera"}
                    </span>
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {m.current?.markName || m.clientLabel || "Sin nombre"}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="text-[color:var(--ink)]">
                    {formatDate(expiry)}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {left === null
                      ? "—"
                      : left < 0
                        ? "vencida"
                        : left === 0
                          ? "hoy"
                          : `${left}d`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
