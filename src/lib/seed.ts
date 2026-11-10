import type Database from "better-sqlite3";
import { buildMockSnapshot } from "@/lib/fetcher/mock";
import type { AppNotification, StatusHistoryEntry } from "@/lib/types";

const SEED_MARKS: {
  expediente: string;
  clientLabel: string;
  notes: string;
}[] = [
  {
    expediente: "2451893",
    clientLabel: "Solaris Energía",
    notes: "Declaración de uso — seguimiento prioritario",
  },
  {
    expediente: "1987654",
    clientLabel: "Beneficio Altura",
    notes: "Responder requerimiento antes de plazo",
  },
  {
    expediente: "2234567",
    clientLabel: "Tecnova México",
    notes: "Oficio pendiente de acuse",
  },
  {
    expediente: "2567890",
    clientLabel: "Ruta Norte",
    notes: "Caducada — evaluar nueva solicitud",
  },
  {
    expediente: "2109876",
    clientLabel: "Bosque Verde",
    notes: "Cartera estable / vigente",
  },
  {
    expediente: "2345678",
    clientLabel: "Horizonte Legal",
    notes: "Renovación dentro de ventana",
  },
];

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function seedIfEmpty(db: Database.Database): void {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM tracked_marks`).get() as {
    c: number;
  };
  if (row.c > 0) return;

  const insertMark = db.prepare(
    `INSERT INTO tracked_marks (expediente, client_label, notes, tracked_at, last_refreshed_at, current_json)
     VALUES (@expediente, @client_label, @notes, @tracked_at, @last_refreshed_at, @current_json)`,
  );
  const insertHistory = db.prepare(
    `INSERT INTO status_history
      (id, expediente, status, status_label, last_movement_date, snapshot_json, recorded_at)
     VALUES (@id, @expediente, @status, @status_label, @last_movement_date, @snapshot_json, @recorded_at)`,
  );
  const insertNotif = db.prepare(
    `INSERT INTO notifications (id, expediente, kind, title, body, created_at, read)
     VALUES (@id, @expediente, @kind, @title, @body, @created_at, @read)`,
  );

  const now = new Date();
  const trackedAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const seedTx = db.transaction(() => {
    for (const mark of SEED_MARKS) {
      const snapshot = buildMockSnapshot(mark.expediente);
      insertMark.run({
        expediente: mark.expediente,
        client_label: mark.clientLabel,
        notes: mark.notes,
        tracked_at: trackedAt,
        last_refreshed_at: snapshot.fetchedAt,
        current_json: JSON.stringify(snapshot),
      });

      const history: StatusHistoryEntry = {
        id: id("hist"),
        expediente: mark.expediente,
        status: snapshot.status,
        statusLabel: snapshot.statusLabel,
        lastMovementDate: snapshot.lastMovementDate,
        snapshot,
        recordedAt: snapshot.fetchedAt,
      };
      insertHistory.run({
        id: history.id,
        expediente: history.expediente,
        status: history.status,
        status_label: history.statusLabel,
        last_movement_date: history.lastMovementDate,
        snapshot_json: JSON.stringify(history.snapshot),
        recorded_at: history.recordedAt,
      });
    }

    const sampleNotifications: AppNotification[] = [
      {
        id: id("notif"),
        expediente: "2451893",
        kind: "status_change",
        title: "Declaración de uso — SOLARIS ENERGÍA",
        body: "El expediente 2451893 pasó a estatus Declaración de uso. Revisar plazo de presentación.",
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        read: false,
      },
      {
        id: id("notif"),
        expediente: "1987654",
        kind: "new_movement",
        title: "Nuevo requerimiento — CAFÉ ALTURA",
        body: "Se registró un requerimiento de información sobre uso efectivo (2025-10-28).",
        createdAt: new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString(),
        read: false,
      },
      {
        id: id("notif"),
        expediente: "2345678",
        kind: "expiry_warning",
        title: "Renovación próxima — HORIZONTE LEGAL",
        body: "La vigencia del expediente 2345678 vence el 2026-01-15. Ventana de renovación abierta.",
        createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        read: true,
      },
      {
        id: id("notif"),
        expediente: "system",
        kind: "fetch_fallback",
        title: "Modo muestra activo",
        body: "El portal público Marcanet/SIGA no está disponible de forma fiable desde este entorno. IMPI usa catálogo mock para demos offline.",
        createdAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
        read: false,
      },
    ];

    for (const n of sampleNotifications) {
      insertNotif.run({
        id: n.id,
        expediente: n.expediente,
        kind: n.kind,
        title: n.title,
        body: n.body,
        created_at: n.createdAt,
        read: n.read ? 1 : 0,
      });
    }
  });

  seedTx();
}
