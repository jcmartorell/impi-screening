"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rememberExpedienteLocally } from "@/components/dashboard/portfolio-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SearchHit } from "@/lib/fetcher/siga-tugaceta";

type SearchApiResponse = {
  ok?: boolean;
  hits?: SearchHit[];
  rawCount?: number;
  blocked?: string;
  error?: string;
  source?: string;
  mode?: string;
  warning?: string;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function expedienteDigits(hit: SearchHit): string | null {
  const digits = (hit.expediente ?? "").replace(/\D/g, "");
  return /^\d{7}$/.test(digits) ? digits : null;
}

export function SearchPanel({ liveMode }: { liveMode: boolean }) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [classNice, setClassNice] = useState("");
  const [sector, setSector] = useState<"marcas" | "patentes" | "proteccion">(
    "marcas",
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [trackMsg, setTrackMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [exporting, startExport] = useTransition();
  const [tracking, startTrack] = useTransition();

  const selectedHits = useMemo(
    () => hits.filter((h) => selected.has(h.fichaId)),
    [hits, selected],
  );
  const trackableCount = useMemo(
    () => selectedHits.filter((h) => expedienteDigits(h)).length,
    [selectedHits],
  );

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === hits.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(hits.map((h) => h.fichaId)));
  }

  function onSearch(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setWarning(null);
    setMeta(null);
    setTrackMsg(null);
    if (!keyword.trim()) {
      setError("Indica una palabra, nombre de marca o expediente.");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          classNice: classNice.trim() || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          sector,
          limit: 150,
        }),
      });
      const data = (await res.json()) as SearchApiResponse;
      if (!res.ok) {
        setHits([]);
        setSelected(new Set());
        setError(
          data.blocked ??
            data.error ??
            "No se pudo consultar SIGA TuGaceta (sin catálogo mock).",
        );
        return;
      }
      const nextHits = data.hits ?? [];
      setHits(nextHits);
      setSelected(new Set());
      setWarning(data.warning ?? null);
      setMeta(
        `${nextHits.length} resultado(s)` +
          (data.rawCount && data.rawCount !== nextHits.length
            ? ` (de ${data.rawCount} crudos)`
            : "") +
          ` · sector ${sector} · fuente ${data.source ?? "—"} · mode ${data.mode ?? "—"}`,
      );
    });
  }

  function onExport(format: "csv" | "json") {
    const chosen = selectedHits;
    if (!chosen.length) {
      setError("Selecciona al menos un resultado para exportar.");
      return;
    }
    setError(null);
    startExport(async () => {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, hits: chosen }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Exportación fallida");
        return;
      }
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `impi-busqueda-${stamp}.${format}`);
    });
  }

  function onTrackSelected() {
    const expedientes = [
      ...new Set(
        selectedHits
          .map((h) => expedienteDigits(h))
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    if (!expedientes.length) {
      setError(
        "Ningún seleccionado tiene expediente de 7 dígitos para seguimiento.",
      );
      return;
    }
    setError(null);
    setTrackMsg(null);
    startTrack(async () => {
      const ok: string[] = [];
      const fail: string[] = [];
      for (const exp of expedientes) {
        const res = await fetch("/api/marks", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expediente: exp }),
        });
        rememberExpedienteLocally(exp);
        if (res.ok) ok.push(exp);
        else {
          const data = (await res.json()) as { error?: string };
          fail.push(`${exp}${data.error ? `: ${data.error}` : ""}`);
        }
      }
      if (ok.length) {
        setTrackMsg(
          `En seguimiento: ${ok.join(", ")}${fail.length ? ` · fallaron ${fail.length}` : ""}`,
        );
        router.refresh();
      }
      if (fail.length && !ok.length) {
        setError(`No se pudo seguir: ${fail.join(" · ")}`);
      } else if (fail.length) {
        setWarning(`Algunos fallaron: ${fail.join(" · ")}`);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-xl text-[color:var(--ink)]">
          Búsqueda
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Flujo principal: filtra por nombre/palabra, fechas, sector y clase
          Niza; exporta o añade a seguimiento.
          {liveMode
            ? " Consulta live a SIGA TuGaceta (sin catálogo mock)."
            : null}
        </p>
      </div>

      <form
        onSubmit={onSearch}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
      >
        <div className="grid gap-1.5 lg:col-span-2">
          <Label htmlFor="search-keyword">Palabra / nombre / expediente</Label>
          <Input
            id="search-keyword"
            placeholder="p. ej. SOLARIS o 1240512"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="search-sector">Sector</Label>
          <select
            id="search-sector"
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={sector}
            onChange={(e) =>
              setSector(e.target.value as "marcas" | "patentes" | "proteccion")
            }
          >
            <option value="marcas">Marcas</option>
            <option value="patentes">Patentes</option>
            <option value="proteccion">Protección</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="search-class">Clase Niza</Label>
          <Input
            id="search-class"
            placeholder="9 o 9,42"
            value={classNice}
            onChange={(e) => setClassNice(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="search-from">Desde</Label>
          <Input
            id="search-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="search-to">Hasta</Label>
          <Input
            id="search-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit" disabled={pending}>
            {pending ? "Buscando…" : "Buscar en SIGA"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={exporting || selected.size === 0}
            onClick={() => onExport("csv")}
          >
            Exportar CSV ({selected.size})
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={exporting || selected.size === 0}
            onClick={() => onExport("json")}
          >
            Exportar JSON
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={tracking || trackableCount === 0}
            onClick={onTrackSelected}
          >
            {tracking
              ? "Agregando…"
              : `Seguir seleccionados (${trackableCount})`}
          </Button>
        </div>
      </form>

      {error ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {warning ? (
        <p className="text-sm text-muted-foreground" role="status">
          {warning}
        </p>
      ) : null}
      {trackMsg ? (
        <p className="text-sm text-[color:var(--teal-deep)]" role="status">
          {trackMsg}
        </p>
      ) : null}
      {meta ? (
        <p className="font-mono text-xs text-muted-foreground">{meta}</p>
      ) : null}

      {hits.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-[color:var(--ink)]/10 bg-white/70">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <thead className="bg-[color:var(--ink)] text-[color:var(--paper)]">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.size === hits.length && hits.length > 0}
                      onChange={toggleAll}
                      aria-label="Seleccionar todos"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Expediente</th>
                  <th className="px-3 py-2 font-medium">Marca</th>
                  <th className="px-3 py-2 font-medium">Clase</th>
                  <th className="px-3 py-2 font-medium">Estatus / sección</th>
                  <th className="px-3 py-2 font-medium">Gaceta</th>
                  <th className="px-3 py-2 font-medium">Publicación</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((hit) => (
                  <tr
                    key={hit.fichaId}
                    className="border-t border-[color:var(--ink)]/8 odd:bg-white/40 even:bg-[color:var(--mist)]/35"
                  >
                    <td className="px-3 py-2 align-top">
                      <input
                        type="checkbox"
                        checked={selected.has(hit.fichaId)}
                        onChange={() => toggle(hit.fichaId)}
                        aria-label={`Seleccionar ficha ${hit.fichaId}`}
                      />
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-[13px]">
                      {hit.expediente ?? "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="font-semibold text-[color:var(--ink)]">
                        {hit.markName ?? "—"}
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {hit.owner ?? "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-[13px]">
                      {hit.classNice ?? "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {hit.statusLabel ?? hit.seccion}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                      {hit.gaceta}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {hit.publicationDate ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
