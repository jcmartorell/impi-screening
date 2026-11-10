import { fetchTrademarkSnapshot, getFetchMode } from "@/lib/fetcher/marcanet";
import { sleep } from "@/lib/fetcher/backoff";
import { diffSnapshots } from "@/lib/diff";
import { notifyFromDiff, notifyPaseStub } from "@/lib/notifier";
import {
  addHistoryEntry,
  getTrackedMark,
  listTrackedMarks,
  upsertTrackedMark,
} from "@/lib/store";
import type { RefreshResult } from "@/lib/types";

function hid(): string {
  return `hist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function refreshExpediente(
  expediente: string,
  options?: { firstTrack?: boolean; clientLabel?: string; notes?: string },
): Promise<RefreshResult> {
  const normalized = expediente.replace(/\D/g, "");
  if (!/^\d{7}$/.test(normalized)) {
    return {
      expediente,
      ok: false,
      source: "mock",
      changed: false,
      notificationsCreated: 0,
      error: "El expediente debe ser un número de 7 dígitos.",
    };
  }

  try {
    const previous = getTrackedMark(normalized)?.current ?? null;
    const snapshot = await fetchTrademarkSnapshot(normalized);
    const diff = diffSnapshots(previous, snapshot);
    const usedMockFallback =
      getFetchMode() === "auto" && snapshot.source === "mock";

    upsertTrackedMark({
      expediente: normalized,
      clientLabel: options?.clientLabel,
      notes: options?.notes,
      current: snapshot,
      lastRefreshedAt: snapshot.fetchedAt,
    });

    if (diff.changed || options?.firstTrack) {
      addHistoryEntry({
        id: hid(),
        expediente: normalized,
        status: snapshot.status,
        statusLabel: snapshot.statusLabel,
        lastMovementDate: snapshot.lastMovementDate,
        snapshot,
        recordedAt: snapshot.fetchedAt,
      });
    }

    const notifications = notifyFromDiff(snapshot, diff, {
      firstTrack: options?.firstTrack,
      usedMockFallback: usedMockFallback && Boolean(options?.firstTrack),
    });

    // Architecture stub: Trigger → … → Notifier (PASE later)
    void notifyPaseStub({
      expediente: normalized,
      message: `Refresh ${normalized} source=${snapshot.source}`,
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
    return {
      expediente: normalized,
      ok: false,
      source: "mock",
      changed: false,
      notificationsCreated: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function refreshAllTracked(): Promise<RefreshResult[]> {
  const marks = listTrackedMarks();
  const results: RefreshResult[] = [];
  for (const mark of marks) {
    results.push(await refreshExpediente(mark.expediente));
    // Polite delay between portal calls
    await sleep(400);
  }
  return results;
}
