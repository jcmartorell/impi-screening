import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  AppNotification,
  StatusHistoryEntry,
  TrackedMark,
  TrademarkSnapshot,
} from "@/lib/types";
import { seedIfEmpty } from "@/lib/seed";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "impi.sqlite");

let dbSingleton: Database.Database | null = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_marks (
      expediente TEXT PRIMARY KEY,
      client_label TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      tracked_at TEXT NOT NULL,
      last_refreshed_at TEXT,
      current_json TEXT
    );

    CREATE TABLE IF NOT EXISTS status_history (
      id TEXT PRIMARY KEY,
      expediente TEXT NOT NULL,
      status TEXT NOT NULL,
      status_label TEXT NOT NULL,
      last_movement_date TEXT,
      snapshot_json TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      expediente TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_history_exp ON status_history(expediente, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at DESC);
  `);
}

export function getDb(): Database.Database {
  if (dbSingleton) return dbSingleton;
  ensureDir();
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  migrate(db);
  dbSingleton = db;
  seedIfEmpty(db);
  return db;
}

function mapTracked(row: Record<string, unknown>): TrackedMark {
  return {
    expediente: String(row.expediente),
    clientLabel: String(row.client_label ?? ""),
    notes: String(row.notes ?? ""),
    trackedAt: String(row.tracked_at),
    lastRefreshedAt: row.last_refreshed_at
      ? String(row.last_refreshed_at)
      : null,
    current: row.current_json
      ? (JSON.parse(String(row.current_json)) as TrademarkSnapshot)
      : null,
  };
}

export function listTrackedMarks(): TrackedMark[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM tracked_marks ORDER BY
        CASE WHEN current_json IS NULL THEN 1 ELSE 0 END,
        tracked_at DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapTracked);
}

export function getTrackedMark(expediente: string): TrackedMark | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM tracked_marks WHERE expediente = ?`)
    .get(expediente) as Record<string, unknown> | undefined;
  return row ? mapTracked(row) : null;
}

export function upsertTrackedMark(input: {
  expediente: string;
  clientLabel?: string;
  notes?: string;
  current?: TrademarkSnapshot | null;
  lastRefreshedAt?: string | null;
}): TrackedMark {
  const db = getDb();
  const existing = getTrackedMark(input.expediente);
  const trackedAt = existing?.trackedAt ?? new Date().toISOString();
  const clientLabel = input.clientLabel ?? existing?.clientLabel ?? "";
  const notes = input.notes ?? existing?.notes ?? "";
  const current =
    input.current === undefined ? existing?.current ?? null : input.current;
  const lastRefreshedAt =
    input.lastRefreshedAt === undefined
      ? existing?.lastRefreshedAt ?? null
      : input.lastRefreshedAt;

  db.prepare(
    `INSERT INTO tracked_marks (expediente, client_label, notes, tracked_at, last_refreshed_at, current_json)
     VALUES (@expediente, @client_label, @notes, @tracked_at, @last_refreshed_at, @current_json)
     ON CONFLICT(expediente) DO UPDATE SET
       client_label = excluded.client_label,
       notes = excluded.notes,
       last_refreshed_at = excluded.last_refreshed_at,
       current_json = excluded.current_json`,
  ).run({
    expediente: input.expediente,
    client_label: clientLabel,
    notes,
    tracked_at: trackedAt,
    last_refreshed_at: lastRefreshedAt,
    current_json: current ? JSON.stringify(current) : null,
  });

  return getTrackedMark(input.expediente)!;
}

export function deleteTrackedMark(expediente: string): boolean {
  const db = getDb();
  const info = db
    .prepare(`DELETE FROM tracked_marks WHERE expediente = ?`)
    .run(expediente);
  return info.changes > 0;
}

export function addHistoryEntry(entry: StatusHistoryEntry): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO status_history
      (id, expediente, status, status_label, last_movement_date, snapshot_json, recorded_at)
     VALUES (@id, @expediente, @status, @status_label, @last_movement_date, @snapshot_json, @recorded_at)`,
  ).run({
    id: entry.id,
    expediente: entry.expediente,
    status: entry.status,
    status_label: entry.statusLabel,
    last_movement_date: entry.lastMovementDate,
    snapshot_json: JSON.stringify(entry.snapshot),
    recorded_at: entry.recordedAt,
  });
}

export function getLatestHistory(expediente: string): StatusHistoryEntry | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM status_history WHERE expediente = ? ORDER BY recorded_at DESC LIMIT 1`,
    )
    .get(expediente) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    expediente: String(row.expediente),
    status: row.status as StatusHistoryEntry["status"],
    statusLabel: String(row.status_label),
    lastMovementDate: row.last_movement_date
      ? String(row.last_movement_date)
      : null,
    snapshot: JSON.parse(String(row.snapshot_json)) as TrademarkSnapshot,
    recordedAt: String(row.recorded_at),
  };
}

export function listHistory(expediente: string, limit = 20): StatusHistoryEntry[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM status_history WHERE expediente = ? ORDER BY recorded_at DESC LIMIT ?`,
    )
    .all(expediente, limit) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    expediente: String(row.expediente),
    status: row.status as StatusHistoryEntry["status"],
    statusLabel: String(row.status_label),
    lastMovementDate: row.last_movement_date
      ? String(row.last_movement_date)
      : null,
    snapshot: JSON.parse(String(row.snapshot_json)) as TrademarkSnapshot,
    recordedAt: String(row.recorded_at),
  }));
}

export function addNotification(
  notification: Omit<AppNotification, "read"> & { read?: boolean },
): AppNotification {
  const db = getDb();
  const full: AppNotification = {
    ...notification,
    read: notification.read ?? false,
  };
  db.prepare(
    `INSERT INTO notifications (id, expediente, kind, title, body, created_at, read)
     VALUES (@id, @expediente, @kind, @title, @body, @created_at, @read)`,
  ).run({
    id: full.id,
    expediente: full.expediente,
    kind: full.kind,
    title: full.title,
    body: full.body,
    created_at: full.createdAt,
    read: full.read ? 1 : 0,
  });
  return full;
}

export function listNotifications(options?: {
  unreadOnly?: boolean;
  limit?: number;
}): AppNotification[] {
  const db = getDb();
  const limit = options?.limit ?? 50;
  const rows = (
    options?.unreadOnly
      ? db
          .prepare(
            `SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT ?`,
          )
          .all(limit)
      : db
          .prepare(
            `SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?`,
          )
          .all(limit)
  ) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: String(row.id),
    expediente: String(row.expediente),
    kind: row.kind as AppNotification["kind"],
    title: String(row.title),
    body: String(row.body),
    createdAt: String(row.created_at),
    read: Boolean(row.read),
  }));
}

export function markNotificationRead(id: string): boolean {
  const db = getDb();
  const info = db
    .prepare(`UPDATE notifications SET read = 1 WHERE id = ?`)
    .run(id);
  return info.changes > 0;
}

export function markAllNotificationsRead(): number {
  const db = getDb();
  const info = db.prepare(`UPDATE notifications SET read = 1 WHERE read = 0`).run();
  return info.changes;
}

export function countTracked(): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS c FROM tracked_marks`).get() as {
    c: number;
  };
  return row.c;
}

export function listExpiringWithin(days: number): TrackedMark[] {
  const marks = listTrackedMarks().filter((m) => m.current?.expiryDate);
  const now = Date.now();
  const horizon = now + days * 24 * 60 * 60 * 1000;
  return marks
    .filter((m) => {
      const expiry = Date.parse(m.current!.expiryDate!);
      return Number.isFinite(expiry) && expiry >= now && expiry <= horizon;
    })
    .sort((a, b) =>
      String(a.current!.expiryDate).localeCompare(String(b.current!.expiryDate)),
    );
}
