import type Database from "better-sqlite3";
import { getFetchMode } from "@/lib/fetcher/marcanet";
import { buildMockSnapshot } from "@/lib/fetcher/mock";
import type { AppNotification, StatusHistoryEntry } from "@/lib/types";

/** Matches local simulated viewer partition (sub::production). */
export const DEV_OWNER_KEY = "user:dev::production";

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

const SEED_EXPEDIENTES = new Set(SEED_MARKS.map((m) => m.expediente));

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Remove legacy mock-seed portfolio left by older deploys on warm /tmp when
 * fetch mode is not mock. Leaves mixed/user-added carteras alone, but always
 * drops inbox rows that claim the mock catalog is active.
 */
function clearLegacySeedWhenLive(db: Database.Database): void {
  db.prepare(
    `DELETE FROM notifications
     WHERE owner_key = ?
       AND kind = 'fetch_fallback'
       AND (
         title = 'Modo muestra activo'
         OR title = 'Consulta en modo muestra'
         OR body LIKE '%catálogo mock%'
         OR body LIKE '%catalogo mock%'
       )`,
  ).run(DEV_OWNER_KEY);

  const marks = db
    .prepare(`SELECT expediente FROM tracked_marks WHERE owner_key = ?`)
    .all(DEV_OWNER_KEY) as { expediente: string }[];
  if (marks.length === 0) return;

  const onlySeed = marks.every((m) => SEED_EXPEDIENTES.has(m.expediente));
  if (!onlySeed) return;

  const wipe = db.transaction(() => {
    db.prepare(`DELETE FROM tracked_marks WHERE owner_key = ?`).run(
      DEV_OWNER_KEY,
    );
    db.prepare(`DELETE FROM status_history WHERE owner_key = ?`).run(
      DEV_OWNER_KEY,
    );
    db.prepare(`DELETE FROM notifications WHERE owner_key = ?`).run(
      DEV_OWNER_KEY,
    );
  });
  wipe();
}

/**
 * Seed mock cartera only when `IMPI_FETCH_MODE=mock`.
 * Live/auto: empty cartera for the demo viewer until a real expediente is added.
 */
export function seedIfEmpty(db: Database.Database): void {
  if (getFetchMode() !== "mock") {
    clearLegacySeedWhenLive(db);
    return;
  }

  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM tracked_marks WHERE owner_key = ?`)
    .get(DEV_OWNER_KEY) as { c: number };
  if (row.c > 0) return;

  const insertMark = db.prepare(
    `INSERT INTO tracked_marks
      (owner_key, expediente, client_label, notes, tracked_at, last_refreshed_at, current_json)
     VALUES (@owner_key, @expediente, @client_label, @notes, @tracked_at, @last_refreshed_at, @current_json)`,
  );
  const insertHistory = db.prepare(
    `INSERT INTO status_history
      (id, owner_key, expediente, status, status_label, last_movement_date, snapshot_json, recorded_at)
     VALUES (@id, @owner_key, @expediente, @status, @status_label, @last_movement_date, @snapshot_json, @recorded_at)`,
  );
  const insertNotif = db.prepare(
    `INSERT INTO notifications
      (id, owner_key, expediente, kind, title, body, created_at, read)
     VALUES (@id, @owner_key, @expediente, @kind, @title, @body, @created_at, @read)`,
  );

  const now = new Date();
  const trackedAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const seedTx = db.transaction(() => {
    for (const mark of SEED_MARKS) {
      const snapshot = buildMockSnapshot(mark.expediente);
      insertMark.run({
        owner_key: DEV_OWNER_KEY,
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
        owner_key: DEV_OWNER_KEY,
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
        body: "La vigencia del expediente 2345678 vence el 2027-01-15. Ventana de renovación abierta.",
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
        owner_key: DEV_OWNER_KEY,
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
