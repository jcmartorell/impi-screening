"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { TrackedMark } from "@/lib/types";

const STORAGE_KEY = "impi_portfolio_local_v1";

type LocalPortfolio = {
  v: 1;
  marks: Array<{
    expediente: string;
    clientLabel?: string;
    notes?: string;
    trackedAt?: string;
    lastRefreshedAt?: string | null;
    current?: TrackedMark["current"];
  }>;
};

/** Mirror tracked expedientes to localStorage (backup if cookie is cleared). */
export function rememberTrackedLocally(marks: TrackedMark[]): void {
  try {
    const payload: LocalPortfolio = {
      v: 1,
      marks: marks.map((m) => ({
        expediente: m.expediente,
        clientLabel: m.clientLabel || undefined,
        notes: m.notes || undefined,
        trackedAt: m.trackedAt,
        lastRefreshedAt: m.lastRefreshedAt,
        current: m.current,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

export function rememberExpedienteLocally(
  expediente: string,
  extra?: {
    clientLabel?: string;
    notes?: string;
    current?: TrackedMark["current"];
  },
): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as LocalPortfolio)
      : { v: 1 as const, marks: [] };
    const digits = expediente.replace(/\D/g, "");
    if (!/^\d{7}$/.test(digits)) return;
    const without = (parsed.marks ?? []).filter((m) => m.expediente !== digits);
    without.unshift({
      expediente: digits,
      clientLabel: extra?.clientLabel,
      notes: extra?.notes,
      current: extra?.current,
      trackedAt: new Date().toISOString(),
    });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, marks: without.slice(0, 50) }),
    );
  } catch {
    // ignore
  }
}

/**
 * Keep localStorage aligned with SSR cartera. If SSR is empty but localStorage
 * still has marks, soft-restore into cookie/SQLite (no live SIGA fetch).
 */
export function PortfolioSync({
  serverCount,
  serverMarks,
}: {
  serverCount: number;
  serverMarks: TrackedMark[];
}) {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (serverCount > 0) {
      rememberTrackedLocally(serverMarks);
      return;
    }
    if (ran.current) return;
    ran.current = true;

    let cancelled = false;
    (async () => {
      let local: LocalPortfolio | null = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) local = JSON.parse(raw) as LocalPortfolio;
      } catch {
        return;
      }
      const restore = (local?.marks ?? []).filter((m) =>
        /^\d{7}$/.test(String(m.expediente ?? "").replace(/\D/g, "")),
      );
      if (!restore.length) return;

      const res = await fetch("/api/marks", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore }),
      });
      if (!cancelled && res.ok) router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [serverCount, serverMarks, router]);

  return null;
}
