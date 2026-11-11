"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AlertSettings({
  initialEmail,
  emailTransport,
  usingDefault = false,
}: {
  initialEmail: string;
  emailTransport: "resend" | "smtp" | "log";
  usingDefault?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertEmail: email.trim() }),
      });
      const data = (await res.json()) as {
        error?: string;
        alertEmail?: string;
        emailTransport?: string;
        usingDefault?: boolean;
      };
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar.");
        return;
      }
      setEmail(data.alertEmail ?? "");
      setSaved(
        data.alertEmail
          ? `Alertas a ${data.alertEmail}`
          : "Correo vacío — no se enviarán emails",
      );
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="alert-email">Correo para alertas de monitoreo</Label>
        <Input
          id="alert-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="ap.vidaln@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="max-w-md"
        />
        <p className="text-xs text-muted-foreground">
          Predeterminado: <code className="font-mono">ap.vidaln@gmail.com</code>
          {usingDefault ? " (activo hasta que guardes otro)" : ""}. Editable;
          vacío = no enviar. Cubre cambios en seguimiento y digest del escaneo
          diario de vencimientos. Transporte:{" "}
          <code className="font-mono">
            {emailTransport === "log"
              ? "log (sin RESEND_API_KEY / SMTP)"
              : emailTransport}
          </code>
          .
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} variant="outline" size="sm">
          {pending ? "Guardando…" : "Guardar correo"}
        </Button>
        {saved ? (
          <p className="text-xs text-[color:var(--teal-deep)]">{saved}</p>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
