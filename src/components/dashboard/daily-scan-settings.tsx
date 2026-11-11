"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DailyScanConfig } from "@/lib/daily-scan-config";

export function DailyScanSettings({
  initial,
  lastRunAt,
}: {
  initial: DailyScanConfig;
  lastRunAt?: string | null;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<DailyScanConfig>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [running, startRun] = useTransition();

  function patch<K extends keyof DailyScanConfig>(
    key: K,
    value: DailyScanConfig[K],
  ) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function onSave(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(null);
    setRunMsg(null);
    startTransition(async () => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyScan: config }),
      });
      const data = (await res.json()) as {
        error?: string;
        dailyScan?: DailyScanConfig;
      };
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar el escaneo.");
        return;
      }
      if (data.dailyScan) setConfig(data.dailyScan);
      setSaved(
        data.dailyScan?.enabled
          ? "Escaneo diario activo"
          : "Escaneo guardado (desactivado)",
      );
      router.refresh();
    });
  }

  function onRunNow() {
    setError(null);
    setRunMsg(null);
    startRun(async () => {
      // Persist current form first so run uses latest filters.
      const saveRes = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyScan: { ...config, enabled: true },
        }),
      });
      if (!saveRes.ok) {
        const data = (await saveRes.json()) as { error?: string };
        setError(data.error ?? "No se pudo guardar antes de ejecutar.");
        return;
      }
      setConfig((prev) => ({ ...prev, enabled: true }));

      const res = await fetch("/api/daily-scan", { method: "POST" });
      const data = (await res.json()) as {
        error?: string;
        ok?: boolean;
        nearExpiry?: number;
        rawHits?: number;
        newForEmail?: number;
        emailed?: boolean;
        emailMode?: string;
        capped?: boolean;
        sample?: {
          expediente: string;
          markName: string;
          expiryDate: string;
          daysLeft: number;
        } | null;
      };
      if (!res.ok || data.ok === false) {
        setError(data.error ?? "Escaneo falló.");
        return;
      }
      const sampleTxt = data.sample
        ? ` · ej. ${data.sample.expediente} (${data.sample.daysLeft}d)`
        : "";
      const cappedTxt = data.capped ? " · TuGaceta tope 1000/gaceta" : "";
      setRunMsg(
        `Listo: ${data.nearExpiry ?? 0} ≤${config.daysWindow}d de ${data.rawHits ?? 0} hits` +
          sampleTxt +
          cappedTxt +
          (data.emailed
            ? ` · email (${data.emailMode ?? "ok"}) ${data.newForEmail ?? 0} nuevos`
            : data.newForEmail
              ? ` · ${data.newForEmail} nuevos (email no enviado)`
              : ""),
      );
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSave} className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-[color:var(--ink)]">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => patch("enabled", e.target.checked)}
            className="size-4 accent-[color:var(--teal-deep)]"
          />
          Activar escaneo diario (cron)
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-[color:var(--ink)]">
          <input
            type="checkbox"
            checked={config.emailDigest}
            onChange={(e) => patch("emailDigest", e.target.checked)}
            className="size-4 accent-[color:var(--teal-deep)]"
          />
          Email si hay nuevos ≤{config.daysWindow}d
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="scan-keywords">
            Palabras / marcas (separadas por coma)
          </Label>
          <Input
            id="scan-keywords"
            placeholder="ej. SOLARIS, INHARA, PUBLIBANCAS"
            value={config.keywords}
            onChange={(e) => patch("keywords", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            TuGaceta exige keyword. El cron busca cada término con los filtros
            de abajo y conserva vigencia ≤ {config.daysWindow} días.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="scan-sector">Sector</Label>
          <select
            id="scan-sector"
            value={config.sector}
            onChange={(e) =>
              patch(
                "sector",
                e.target.value as DailyScanConfig["sector"],
              )
            }
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            <option value="marcas">Marcas</option>
            <option value="patentes">Patentes</option>
            <option value="proteccion">Protección</option>
          </select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="scan-class">Clase Niza</Label>
          <Input
            id="scan-class"
            placeholder="ej. 9, 35"
            value={config.classNice}
            onChange={(e) => patch("classNice", e.target.value)}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="scan-from">Publicación desde</Label>
          <Input
            id="scan-from"
            type="date"
            value={config.dateFrom}
            onChange={(e) => patch("dateFrom", e.target.value)}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="scan-to">Publicación hasta</Label>
          <Input
            id="scan-to"
            type="date"
            value={config.dateTo}
            onChange={(e) => patch("dateTo", e.target.value)}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="scan-days">Ventana de vencimiento (días)</Label>
          <Input
            id="scan-days"
            type="number"
            min={1}
            max={3650}
            value={config.daysWindow}
            onChange={(e) =>
              patch("daysWindow", Number(e.target.value) || 30)
            }
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="scan-limit">Límite por keyword</Label>
          <Input
            id="scan-limit"
            type="number"
            min={1}
            max={12000}
            value={config.limitPerKeyword}
            onChange={(e) =>
              patch("limitPerKeyword", Number(e.target.value) || 8000)
            }
          />
          <p className="text-xs text-muted-foreground">
            Paginación por gaceta (tope TuGaceta ≈1000/consulta). Default 8000.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} variant="outline" size="sm">
          {pending ? "Guardando…" : "Guardar escaneo"}
        </Button>
        <Button
          type="button"
          disabled={running || !config.keywords.trim()}
          size="sm"
          onClick={onRunNow}
        >
          {running ? "Escaneando…" : "Ejecutar ahora"}
        </Button>
        {saved ? (
          <p className="text-xs text-[color:var(--teal-deep)]">{saved}</p>
        ) : null}
      </div>

      {lastRunAt ? (
        <p className="text-xs text-muted-foreground">
          Última corrida:{" "}
          <time dateTime={lastRunAt}>
            {new Intl.DateTimeFormat("es-MX", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(lastRunAt))}
          </time>
        </p>
      ) : null}

      {runMsg ? (
        <p className="text-xs text-[color:var(--teal-deep)]">{runMsg}</p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
