"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onClick() {
    setMessage(null);
    startTransition(async () => {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        count?: number;
        changed?: number;
        mode?: string;
        error?: string;
      };
      if (!res.ok) {
        setMessage(data.error ?? "Error al refrescar");
        return;
      }
      setMessage(
        `Actualizados ${data.count ?? 0} · cambios ${data.changed ?? 0} · modo ${data.mode ?? "auto"}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={onClick}
        disabled={pending}
        className="gap-2 border-[color:var(--ink)]/15 bg-white/70"
      >
        <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Consultando portal…" : "Refrescar cartera"}
      </Button>
      {message ? (
        <p className="max-w-xs text-right text-xs text-muted-foreground">{message}</p>
      ) : null}
    </div>
  );
}
