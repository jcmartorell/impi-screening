import { StatusBadge } from "@/components/status-badge";
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

function daysToExpiry(expiry: string | null | undefined): string {
  if (!expiry) return "—";
  const ms = Date.parse(expiry) - Date.now();
  if (!Number.isFinite(ms)) return "—";
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days < 0) return "vencida";
  if (days === 0) return "hoy";
  return `${days}d`;
}

export function MarksTable({ marks }: { marks: TrackedMark[] }) {
  if (marks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[color:var(--ink)]/15 bg-white/50 px-5 py-12 text-center">
        <p className="font-[family-name:var(--font-display)] text-xl text-[color:var(--ink)]">
          Sin expedientes en seguimiento
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Da de alta un expediente de 7 dígitos para comenzar el monitoreo.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--ink)]/10 bg-white/70 shadow-[0_10px_40px_-28px_rgba(11,31,42,0.45)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="bg-[color:var(--ink)] text-[color:var(--paper)]">
            <tr>
              <th className="px-4 py-3 font-medium">Expediente</th>
              <th className="px-4 py-3 font-medium">Marca / cliente</th>
              <th className="px-4 py-3 font-medium">Estatus</th>
              <th className="px-4 py-3 font-medium">Último movimiento</th>
              <th className="px-4 py-3 font-medium">Vigencia</th>
              <th className="px-4 py-3 font-medium">Fuente</th>
            </tr>
          </thead>
          <tbody>
            {marks.map((mark) => {
              const current = mark.current;
              return (
                <tr
                  key={mark.expediente}
                  className="border-t border-[color:var(--ink)]/8 odd:bg-white/40 even:bg-[color:var(--mist)]/35"
                >
                  <td className="px-4 py-3 align-top font-mono text-[13px] text-[color:var(--ink)]">
                    {mark.expediente}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold text-[color:var(--ink)]">
                      {current?.markName ?? "Sin datos"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {mark.clientLabel || current?.owner || "—"}
                    </div>
                    {mark.notes ? (
                      <div className="mt-1 text-xs text-muted-foreground/90">
                        {mark.notes}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {current ? (
                      <StatusBadge
                        status={current.status}
                        label={current.statusLabel}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-muted-foreground">
                    {formatDate(current?.lastMovementDate)}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div>{formatDate(current?.expiryDate)}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {daysToExpiry(current?.expiryDate)}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className="rounded-md border border-[color:var(--ink)]/10 bg-white/80 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                      {current?.source ?? "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
