import { Badge } from "@/components/ui/badge";
import type { TrademarkStatus } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE: Record<TrademarkStatus, string> = {
  vigente: "border-emerald-700/30 bg-emerald-50 text-emerald-900",
  declaracion_de_uso: "border-amber-700/30 bg-amber-50 text-amber-950",
  requerimiento: "border-orange-700/35 bg-orange-50 text-orange-950",
  oficio: "border-sky-700/30 bg-sky-50 text-sky-950",
  caducada: "border-stone-500/40 bg-stone-100 text-stone-700",
  cancelada: "border-rose-700/30 bg-rose-50 text-rose-950",
  renovacion: "border-[color:var(--brass)]/40 bg-[color:var(--brass-soft)] text-[color:var(--ink)]",
  en_tramite: "border-teal-700/30 bg-teal-50 text-teal-950",
  desconocida: "border-border bg-muted text-muted-foreground",
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: TrademarkStatus;
  label?: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md px-2 py-0.5 font-medium tracking-tight",
        TONE[status] ?? TONE.desconocida,
        className,
      )}
    >
      {label ?? STATUS_LABELS[status]}
    </Badge>
  );
}
