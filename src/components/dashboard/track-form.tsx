"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TrackForm() {
  const router = useRouter();
  const [expediente, setExpediente] = useState("");
  const [clientLabel, setClientLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const digits = expediente.replace(/\D/g, "");
    if (!/^\d{7}$/.test(digits)) {
      setError("Ingresa un expediente de 7 dígitos.");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expediente: digits,
          clientLabel: clientLabel.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "No se pudo registrar el expediente.");
        return;
      }
      setExpediente("");
      setClientLabel("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor="expediente">Expediente (7 dígitos)</Label>
        <Input
          id="expediente"
          inputMode="numeric"
          placeholder="2451893"
          value={expediente}
          onChange={(e) => setExpediente(e.target.value)}
          maxLength={8}
          className="font-mono"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="client">Cliente / etiqueta</Label>
        <Input
          id="client"
          placeholder="Nombre del cliente"
          value={clientLabel}
          onChange={(e) => setClientLabel(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending} className="sm:mb-0.5">
        {pending ? "Registrando…" : "Dar de alta"}
      </Button>
      {error ? (
        <p className="text-sm text-destructive sm:col-span-3" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
