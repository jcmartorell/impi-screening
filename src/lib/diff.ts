import type { TrademarkSnapshot } from "@/lib/types";

export interface SnapshotDiff {
  statusChanged: boolean;
  previousStatus: string | null;
  nextStatus: string;
  newMovements: TrademarkSnapshot["movements"];
  expiryChanged: boolean;
  changed: boolean;
}

export function diffSnapshots(
  previous: TrademarkSnapshot | null | undefined,
  next: TrademarkSnapshot,
): SnapshotDiff {
  if (!previous) {
    return {
      statusChanged: false,
      previousStatus: null,
      nextStatus: next.status,
      newMovements: next.movements,
      expiryChanged: false,
      changed: true,
    };
  }

  const prevIds = new Set(previous.movements.map((m) => `${m.date}|${m.description}`));
  const newMovements = next.movements.filter(
    (m) => !prevIds.has(`${m.date}|${m.description}`),
  );
  const statusChanged = previous.status !== next.status;
  const expiryChanged = previous.expiryDate !== next.expiryDate;
  const movementDateChanged =
    previous.lastMovementDate !== next.lastMovementDate;

  return {
    statusChanged,
    previousStatus: previous.status,
    nextStatus: next.status,
    newMovements,
    expiryChanged,
    changed:
      statusChanged ||
      expiryChanged ||
      movementDateChanged ||
      newMovements.length > 0 ||
      previous.statusLabel !== next.statusLabel,
  };
}
