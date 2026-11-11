import { fetchTrademarkSnapshot, getFetchMode } from "@/lib/fetcher/marcanet";
import { sleep } from "@/lib/fetcher/backoff";
import { diffSnapshots } from "@/lib/diff";
import {
  dispatchEmailAlerts,
  notifyFetchFailure,
  notifyFromDiff,
  notifyPaseStub,
} from "@/lib/notifier";
import {
  MAX_MARKS_PER_REFRESH,
  PORTAL_CALL_GAP_MS,
} from "@/lib/limits";
import {
  addHistoryEntry,
  getTrackedMark,
  listOwnerKeysWithTrackedMarks,
  listTrackedMarks,
  upsertTrackedMark,
} from "@/lib/store";
import type { RefreshResult } from "@/lib/types";

function hid(): string {
  return `hist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function refreshExpediente(
  ownerKey: string,
  expediente: string,
  options?: {
    firstTrack?: boolean;
    clientLabel?: string;
    notes?: string;
    enforceCap?: boolean;
  },
): Promise<RefreshResult> {
  const normalized = expediente.replace(/\D/g, "");
  if (!/^\d{7}$/.test(normalized)) {
    return {
      expediente,
      ok: false,
      source: "live",
      changed: false,
      notificationsCreated: 0,
      error: "El expediente debe ser un número de 7 dígitos.",
    };
  }

  const mode = getFetchMode();

  try {
    const previous = getTrackedMark(ownerKey, normalized)?.current ?? null;
    const snapshot = await fetchTrademarkSnapshot(normalized);
    const diff = diffSnapshots(previous, snapshot);

    const upserted = upsertTrackedMark({
      ownerKey,
      expediente: normalized,
      clientLabel: options?.clientLabel,
      notes: options?.notes,
      current: snapshot,
      lastRefreshedAt: snapshot.fetchedAt,
      enforceCap: options?.enforceCap ?? options?.firstTrack,
    });

    if ("error" in upserted) {
      return {
        expediente: normalized,
        ok: false,
        source: snapshot.source,
        changed: false,
        notificationsCreated: 0,
        error: `Límite de ${upserted.max} expedientes por cartera alcanzado.`,
      };
    }

    if (diff.changed || options?.firstTrack) {
      addHistoryEntry(ownerKey, {
        id: hid(),
        expediente: normalized,
        status: snapshot.status,
        statusLabel: snapshot.statusLabel,
        lastMovementDate: snapshot.lastMovementDate,
        snapshot,
        recordedAt: snapshot.fetchedAt,
      });
    }

    const notifications = notifyFromDiff(ownerKey, snapshot, diff, {
      firstTrack: options?.firstTrack,
      usedMockFallback: false,
    });

    // First track is "en seguimiento", not a modification vs history.
    if (!options?.firstTrack && previous) {
      void dispatchEmailAlerts(ownerKey, notifications).catch((error) => {
        console.warn(
          "[impi-email] dispatch failed",
          normalized,
          error instanceof Error ? error.message : error,
        );
      });
    }

    void notifyPaseStub({
      expediente: normalized,
      message: `Refresh ${normalized} source=${snapshot.source} mode=${mode}`,
    });

    return {
      expediente: normalized,
      ok: true,
      source: snapshot.source,
      changed: diff.changed,
      notificationsCreated: notifications.length,
      snapshot,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Live/auto: surface failure; never invent mock catalog data.
    const notification =
      mode !== "mock"
        ? notifyFetchFailure(ownerKey, normalized, message)
        : null;

    return {
      expediente: normalized,
      ok: false,
      source: mode === "mock" ? "mock" : "live",
      changed: false,
      notificationsCreated: notification ? 1 : 0,
      error: message,
    };
  }
}

export async function refreshAllTracked(
  ownerKey: string,
): Promise<RefreshResult[]> {
  const marks = listTrackedMarks(ownerKey).slice(0, MAX_MARKS_PER_REFRESH);
  const results: RefreshResult[] = [];
  for (const mark of marks) {
    results.push(await refreshExpediente(ownerKey, mark.expediente));
    await sleep(PORTAL_CALL_GAP_MS);
  }
  return results;
}

export type CronOwnerRefresh = {
  ownerKey: string;
  count: number;
  failed: number;
  changed: number;
  results: RefreshResult[];
};

/** Cron path: refresh every owner that has a seguimiento list. */
export async function refreshAllOwnersForCron(): Promise<CronOwnerRefresh[]> {
  const owners = listOwnerKeysWithTrackedMarks();
  const out: CronOwnerRefresh[] = [];
  for (const ownerKey of owners) {
    const results = await refreshAllTracked(ownerKey);
    out.push({
      ownerKey,
      count: results.length,
      failed: results.filter((r) => !r.ok).length,
      changed: results.filter((r) => r.changed).length,
      results,
    });
  }
  return out;
}
