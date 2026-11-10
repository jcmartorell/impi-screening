import { addNotification } from "@/lib/store";
import type { SnapshotDiff } from "@/lib/diff";
import type { AppNotification, TrademarkSnapshot } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";

function nid(): string {
  return `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function notifyFromDiff(
  snapshot: TrademarkSnapshot,
  diff: SnapshotDiff,
  options?: { firstTrack?: boolean; usedMockFallback?: boolean },
): AppNotification[] {
  const created: AppNotification[] = [];

  if (options?.firstTrack) {
    created.push(
      addNotification({
        id: nid(),
        expediente: snapshot.expediente,
        kind: "tracked",
        title: `Expediente ${snapshot.expediente} en seguimiento`,
        body: `${snapshot.markName} — estatus actual: ${snapshot.statusLabel}.`,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  if (diff.statusChanged && diff.previousStatus) {
    created.push(
      addNotification({
        id: nid(),
        expediente: snapshot.expediente,
        kind: "status_change",
        title: `Cambio de estatus — ${snapshot.markName}`,
        body: `${snapshot.expediente}: ${STATUS_LABELS[diff.previousStatus as keyof typeof STATUS_LABELS] ?? diff.previousStatus} → ${snapshot.statusLabel}.`,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  for (const movement of diff.newMovements.slice(0, 5)) {
    created.push(
      addNotification({
        id: nid(),
        expediente: snapshot.expediente,
        kind: "new_movement",
        title: `Nuevo movimiento — ${snapshot.markName}`,
        body: `${movement.date}: ${movement.description}`,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  if (snapshot.expiryDate) {
    const days =
      (Date.parse(snapshot.expiryDate) - Date.now()) / (24 * 60 * 60 * 1000);
    if (days >= 0 && days <= 120) {
      created.push(
        addNotification({
          id: nid(),
          expediente: snapshot.expediente,
          kind: "expiry_warning",
          title: `Vencimiento cercano — ${snapshot.markName}`,
          body: `Vigencia hasta ${snapshot.expiryDate} (≈ ${Math.ceil(days)} días).`,
          createdAt: new Date().toISOString(),
        }),
      );
    }
  }

  if (options?.usedMockFallback) {
    created.push(
      addNotification({
        id: nid(),
        expediente: snapshot.expediente,
        kind: "fetch_fallback",
        title: "Consulta en modo muestra",
        body: `No se obtuvo respuesta fiable del portal público para ${snapshot.expediente}; se usó catálogo mock.`,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  return created;
}

/** Stub: PASE authenticated login/notifications (credentials later). */
export async function notifyPaseStub(_payload: {
  expediente: string;
  message: string;
}): Promise<{ ok: false; reason: string }> {
  return {
    ok: false,
    reason: "PASE stub only — authenticated IMPI PASE notifications are out of scope for v1.",
  };
}
