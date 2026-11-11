import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  AppNotification,
  StatusHistoryEntry,
  TrackedMark,
  TrademarkSnapshot,
} from "@/lib/types";
import { DEFAULT_ALERT_EMAIL } from "@/lib/alert-defaults";
import {
  DEFAULT_DAILY_SCAN_CONFIG,
  normalizeDailyScanConfig,
  type DailyScanConfig,
} from "@/lib/daily-scan-config";
import {
  MAX_HISTORY_PER_MARK,
  MAX_NOTIFICATIONS_PER_OWNER,
  MAX_TRACKED_MARKS_PER_OWNER,
} from "@/lib/limits";
import { seedIfEmpty } from "@/lib/seed";

/** Vercel/Lambda only allow writes under /tmp; local/dev keep ./data. */
const IS_SERVERLESS =
  Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

const DATA_DIR = IS_SERVERLESS
  ? path.join("/tmp", "impi-data")
  : path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "impi.sqlite");

let dbSingleton: Database.Database | null = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function migrate(db: Database.Database) {
  const cols = db
    .prepare(`PRAGMA table_info(tracked_marks)`)
    .all() as { name: string }[];
  const hasOwner = cols.some((c) => c.name === "owner_key");

  if (cols.length > 0 && !hasOwner) {
    // Dev/demo DB from v1 without ownership — rebuild so authz is enforceable.
    db.exec(`
      DROP TABLE IF EXISTS tracked_marks;
      DROP TABLE IF EXISTS status_history;
      DROP TABLE IF EXISTS notifications;
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_marks (
      owner_key TEXT NOT NULL,
      expediente TEXT NOT NULL,
      client_label TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      tracked_at TEXT NOT NULL,
      last_refreshed_at TEXT,
      current_json TEXT,
      PRIMARY KEY (owner_key, expediente)
    );

    CREATE TABLE IF NOT EXISTS status_history (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      expediente TEXT NOT NULL,
      status TEXT NOT NULL,
      status_label TEXT NOT NULL,
      last_movement_date TEXT,
      snapshot_json TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      expediente TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS owner_settings (
      owner_key TEXT PRIMARY KEY,
      alert_email TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_scan_hits (
      owner_key TEXT NOT NULL,
      expediente TEXT NOT NULL,
      mark_name TEXT NOT NULL DEFAULT '',
      class_nice TEXT NOT NULL DEFAULT '',
      expiry_date TEXT NOT NULL,
      ficha_id INTEGER,
      snapshot_json TEXT,
      found_at TEXT NOT NULL,
      emailed INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner_key, expediente)
    );

    CREATE INDEX IF NOT EXISTS idx_marks_owner ON tracked_marks(owner_key);
    CREATE INDEX IF NOT EXISTS idx_history_owner_exp
      ON status_history(owner_key, expediente, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_notif_owner_created
      ON notifications(owner_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scan_hits_owner_expiry
      ON daily_scan_hits(owner_key, expiry_date);
  `);

  // Additive columns for daily scan config (safe on existing DBs).
  const settingsCols = db
    .prepare(`PRAGMA table_info(owner_settings)`)
    .all() as { name: string }[];
  const settingsNames = new Set(settingsCols.map((c) => c.name));
  if (!settingsNames.has("daily_scan_json")) {
    db.exec(
      `ALTER TABLE owner_settings ADD COLUMN daily_scan_json TEXT NOT NULL DEFAULT ''`,
    );
  }
  if (!settingsNames.has("daily_scan_updated_at")) {
    db.exec(
      `ALTER TABLE owner_settings ADD COLUMN daily_scan_updated_at TEXT`,
    );
  }
  if (!settingsNames.has("daily_scan_last_run_at")) {
    db.exec(
      `ALTER TABLE owner_settings ADD COLUMN daily_scan_last_run_at TEXT`,
    );
  }
}

export type OwnerSettings = {
  ownerKey: string;
  alertEmail: string;
  updatedAt: string | null;
  /** True when the value comes from DEFAULT_ALERT_EMAIL (no saved row yet). */
  usingDefault: boolean;
  dailyScan: DailyScanConfig;
  dailyScanUpdatedAt: string | null;
  dailyScanLastRunAt: string | null;
  /** True when daily_scan_json was never saved for this owner. */
  dailyScanUsingDefault: boolean;
};

function parseDailyScanRow(
  row: Record<string, unknown> | undefined,
): Pick<
  OwnerSettings,
  "dailyScan" | "dailyScanUpdatedAt" | "dailyScanLastRunAt" | "dailyScanUsingDefault"
> {
  const raw = row?.daily_scan_json ? String(row.daily_scan_json) : "";
  if (!raw) {
    return {
      dailyScan: { ...DEFAULT_DAILY_SCAN_CONFIG },
      dailyScanUpdatedAt: null,
      dailyScanLastRunAt: row?.daily_scan_last_run_at
        ? String(row.daily_scan_last_run_at)
        : null,
      dailyScanUsingDefault: true,
    };
  }
  try {
    return {
      dailyScan: normalizeDailyScanConfig(
        JSON.parse(raw) as Partial<DailyScanConfig>,
      ),
      dailyScanUpdatedAt: row?.daily_scan_updated_at
        ? String(row.daily_scan_updated_at)
        : null,
      dailyScanLastRunAt: row?.daily_scan_last_run_at
        ? String(row.daily_scan_last_run_at)
        : null,
      dailyScanUsingDefault: false,
    };
  } catch {
    return {
      dailyScan: { ...DEFAULT_DAILY_SCAN_CONFIG },
      dailyScanUpdatedAt: null,
      dailyScanLastRunAt: row?.daily_scan_last_run_at
        ? String(row.daily_scan_last_run_at)
        : null,
      dailyScanUsingDefault: true,
    };
  }
}

export function getOwnerSettings(ownerKey: string): OwnerSettings {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM owner_settings WHERE owner_key = ?`)
    .get(ownerKey) as Record<string, unknown> | undefined;
  const scan = parseDailyScanRow(row);
  if (!row) {
    return {
      ownerKey,
      alertEmail: DEFAULT_ALERT_EMAIL,
      updatedAt: null,
      usingDefault: true,
      ...scan,
    };
  }
  return {
    ownerKey,
    alertEmail: String(row.alert_email ?? ""),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    usingDefault: false,
    ...scan,
  };
}

function ensureOwnerSettingsRow(ownerKey: string): void {
  const db = getDb();
  const existing = db
    .prepare(`SELECT owner_key FROM owner_settings WHERE owner_key = ?`)
    .get(ownerKey);
  if (existing) return;
  db.prepare(
    `INSERT INTO owner_settings (owner_key, alert_email, updated_at)
     VALUES (?, '', ?)`,
  ).run(ownerKey, new Date().toISOString());
}

export function setOwnerAlertEmail(
  ownerKey: string,
  alertEmail: string,
): OwnerSettings {
  const db = getDb();
  const cleaned = alertEmail.trim();
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO owner_settings (owner_key, alert_email, updated_at)
     VALUES (@owner_key, @alert_email, @updated_at)
     ON CONFLICT(owner_key) DO UPDATE SET
       alert_email = excluded.alert_email,
       updated_at = excluded.updated_at`,
  ).run({
    owner_key: ownerKey,
    alert_email: cleaned,
    updated_at: updatedAt,
  });
  return getOwnerSettings(ownerKey);
}

export function setOwnerDailyScanConfig(
  ownerKey: string,
  config: Partial<DailyScanConfig>,
): OwnerSettings {
  const db = getDb();
  ensureOwnerSettingsRow(ownerKey);
  const normalized = normalizeDailyScanConfig(config);
  const updatedAt = new Date().toISOString();
  db.prepare(
    `UPDATE owner_settings
     SET daily_scan_json = @daily_scan_json,
         daily_scan_updated_at = @daily_scan_updated_at,
         updated_at = COALESCE(updated_at, @daily_scan_updated_at)
     WHERE owner_key = @owner_key`,
  ).run({
    owner_key: ownerKey,
    daily_scan_json: JSON.stringify(normalized),
    daily_scan_updated_at: updatedAt,
  });
  return getOwnerSettings(ownerKey);
}

export function touchDailyScanLastRun(
  ownerKey: string,
  at = new Date().toISOString(),
): void {
  const db = getDb();
  ensureOwnerSettingsRow(ownerKey);
  db.prepare(
    `UPDATE owner_settings SET daily_scan_last_run_at = ? WHERE owner_key = ?`,
  ).run(at, ownerKey);
}

/** Owners with an enabled daily scan config saved in SQLite. */
export function listOwnerKeysWithDailyScanEnabled(): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT owner_key, daily_scan_json FROM owner_settings
       WHERE daily_scan_json IS NOT NULL AND daily_scan_json != ''`,
    )
    .all() as { owner_key: string; daily_scan_json: string }[];
  const out: string[] = [];
  for (const row of rows) {
    try {
      const cfg = normalizeDailyScanConfig(
        JSON.parse(row.daily_scan_json) as Partial<DailyScanConfig>,
      );
      if (cfg.enabled) out.push(row.owner_key);
    } catch {
      /* skip */
    }
  }
  return out;
}

export type DailyScanHit = {
  expediente: string;
  markName: string;
  classNice: string;
  expiryDate: string;
  fichaId: number | null;
  snapshot: TrademarkSnapshot | null;
  foundAt: string;
  emailed: boolean;
};

function mapScanHit(row: Record<string, unknown>): DailyScanHit {
  return {
    expediente: String(row.expediente),
    markName: String(row.mark_name ?? ""),
    classNice: String(row.class_nice ?? ""),
    expiryDate: String(row.expiry_date),
    fichaId:
      row.ficha_id == null || row.ficha_id === ""
        ? null
        : Number(row.ficha_id),
    snapshot: row.snapshot_json
      ? (JSON.parse(String(row.snapshot_json)) as TrademarkSnapshot)
      : null,
    foundAt: String(row.found_at),
    emailed: Boolean(row.emailed),
  };
}

export function listDailyScanHits(
  ownerKey: string,
  days?: number,
): DailyScanHit[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM daily_scan_hits WHERE owner_key = ?
       ORDER BY expiry_date ASC`,
    )
    .all(ownerKey) as Record<string, unknown>[];
  let hits = rows.map(mapScanHit);
  if (days != null && Number.isFinite(days)) {
    const now = Date.now();
    const horizon = now + days * 24 * 60 * 60 * 1000;
    hits = hits.filter((h) => {
      const t = Date.parse(h.expiryDate);
      return Number.isFinite(t) && t >= now && t <= horizon;
    });
  }
  return hits;
}

export function replaceDailyScanHits(
  ownerKey: string,
  hits: Array<{
    expediente: string;
    markName: string;
    classNice?: string;
    expiryDate: string;
    fichaId?: number | null;
    snapshot?: TrademarkSnapshot | null;
    emailed?: boolean;
  }>,
): DailyScanHit[] {
  const db = getDb();
  const previous = new Map(
    listDailyScanHits(ownerKey).map((h) => [h.expediente, h]),
  );
  const foundAt = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM daily_scan_hits WHERE owner_key = ?`).run(ownerKey);
    const insert = db.prepare(
      `INSERT INTO daily_scan_hits
        (owner_key, expediente, mark_name, class_nice, expiry_date, ficha_id, snapshot_json, found_at, emailed)
       VALUES (@owner_key, @expediente, @mark_name, @class_nice, @expiry_date, @ficha_id, @snapshot_json, @found_at, @emailed)`,
    );
    for (const hit of hits) {
      const digits = hit.expediente.replace(/\D/g, "");
      if (!digits) continue;
      const prev = previous.get(digits);
      insert.run({
        owner_key: ownerKey,
        expediente: digits.length >= 7 ? digits.slice(0, 7) : digits.padStart(7, "0"),
        mark_name: (hit.markName || "").slice(0, 200),
        class_nice: (hit.classNice || "").slice(0, 40),
        expiry_date: hit.expiryDate,
        ficha_id: hit.fichaId ?? null,
        snapshot_json: hit.snapshot ? JSON.stringify(hit.snapshot) : null,
        found_at: foundAt,
        emailed: (hit.emailed ?? Boolean(prev?.emailed)) ? 1 : 0,
      });
    }
  });
  tx();
  return listDailyScanHits(ownerKey);
}

export function markDailyScanHitsEmailed(
  ownerKey: string,
  expedientes: string[],
): void {
  if (!expedientes.length) return;
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE daily_scan_hits SET emailed = 1
     WHERE owner_key = ? AND expediente = ?`,
  );
  const tx = db.transaction(() => {
    for (const exp of expedientes) {
      const digits = exp.replace(/\D/g, "");
      if (!digits) continue;
      stmt.run(ownerKey, digits.length >= 7 ? digits.slice(0, 7) : digits.padStart(7, "0"));
    }
  });
  tx();
}

/** Merge tracked portfolio expiry + daily scan hits (dedupe by expediente). */
export function listExpiringCombined(
  ownerKey: string,
  days: number,
): Array<TrackedMark & { source: "tracked" | "scan" }> {
  const tracked = listExpiringWithin(ownerKey, days).map((m) => ({
    ...m,
    source: "tracked" as const,
  }));
  const seen = new Set(tracked.map((m) => m.expediente));
  const fromScan: Array<TrackedMark & { source: "tracked" | "scan" }> = [];
  for (const hit of listDailyScanHits(ownerKey, days)) {
    if (seen.has(hit.expediente)) continue;
    seen.add(hit.expediente);
    fromScan.push({
      expediente: hit.expediente,
      clientLabel: "",
      notes: "Escaneo diario",
      trackedAt: hit.foundAt,
      lastRefreshedAt: hit.foundAt,
      current:
        hit.snapshot ??
        ({
          expediente: hit.expediente,
          markName: hit.markName || `Expediente ${hit.expediente}`,
          owner: "—",
          status: "desconocida",
          statusLabel: "Escaneo diario",
          classNice: hit.classNice || "—",
          grantDate: null,
          expiryDate: hit.expiryDate,
          lastMovementDate: null,
          movements: [],
          fetchedAt: hit.foundAt,
          source: "live",
        } satisfies TrademarkSnapshot),
      source: "scan",
    });
  }
  return [...tracked, ...fromScan].sort((a, b) =>
    String(a.current?.expiryDate ?? "").localeCompare(
      String(b.current?.expiryDate ?? ""),
    ),
  );
}

/** Distinct owners that currently have at least one tracked expediente. */
export function listOwnerKeysWithTrackedMarks(): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT owner_key FROM tracked_marks ORDER BY owner_key ASC`,
    )
    .all() as { owner_key: string }[];
  return rows.map((r) => r.owner_key);
}

export function getDb(): Database.Database {
  if (dbSingleton) return dbSingleton;
  ensureDir();
  const db = new Database(DB_PATH);
  // WAL needs sidecar files; delete/truncate is safer on ephemeral /tmp.
  db.pragma(IS_SERVERLESS ? "journal_mode = DELETE" : "journal_mode = WAL");
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

export function countTrackedForOwner(ownerKey: string): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM tracked_marks WHERE owner_key = ?`)
    .get(ownerKey) as { c: number };
  return row.c;
}

export function listTrackedMarks(ownerKey: string): TrackedMark[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM tracked_marks WHERE owner_key = ? ORDER BY
        CASE WHEN current_json IS NULL THEN 1 ELSE 0 END,
        tracked_at DESC`,
    )
    .all(ownerKey) as Record<string, unknown>[];
  return rows.map(mapTracked);
}

export function getTrackedMark(
  ownerKey: string,
  expediente: string,
): TrackedMark | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM tracked_marks WHERE owner_key = ? AND expediente = ?`,
    )
    .get(ownerKey, expediente) as Record<string, unknown> | undefined;
  return row ? mapTracked(row) : null;
}

export function upsertTrackedMark(input: {
  ownerKey: string;
  expediente: string;
  clientLabel?: string;
  notes?: string;
  current?: TrademarkSnapshot | null;
  lastRefreshedAt?: string | null;
  /** Preserve cookie/original track time on hydrate. */
  trackedAt?: string;
  /** When true, refuse insert if owner is at cap (updates still allowed). */
  enforceCap?: boolean;
}): TrackedMark | { error: "cap_exceeded"; max: number } {
  const db = getDb();
  const existing = getTrackedMark(input.ownerKey, input.expediente);
  if (!existing && input.enforceCap) {
    const count = countTrackedForOwner(input.ownerKey);
    if (count >= MAX_TRACKED_MARKS_PER_OWNER) {
      return { error: "cap_exceeded", max: MAX_TRACKED_MARKS_PER_OWNER };
    }
  }

  const trackedAt =
    existing?.trackedAt ?? input.trackedAt ?? new Date().toISOString();
  const clientLabel = input.clientLabel ?? existing?.clientLabel ?? "";
  const notes = input.notes ?? existing?.notes ?? "";
  const current =
    input.current === undefined ? existing?.current ?? null : input.current;
  const lastRefreshedAt =
    input.lastRefreshedAt === undefined
      ? existing?.lastRefreshedAt ?? null
      : input.lastRefreshedAt;

  db.prepare(
    `INSERT INTO tracked_marks
      (owner_key, expediente, client_label, notes, tracked_at, last_refreshed_at, current_json)
     VALUES (@owner_key, @expediente, @client_label, @notes, @tracked_at, @last_refreshed_at, @current_json)
     ON CONFLICT(owner_key, expediente) DO UPDATE SET
       client_label = excluded.client_label,
       notes = excluded.notes,
       last_refreshed_at = excluded.last_refreshed_at,
       current_json = excluded.current_json`,
  ).run({
    owner_key: input.ownerKey,
    expediente: input.expediente,
    client_label: clientLabel,
    notes,
    tracked_at: trackedAt,
    last_refreshed_at: lastRefreshedAt,
    current_json: current ? JSON.stringify(current) : null,
  });

  return getTrackedMark(input.ownerKey, input.expediente)!;
}

export function addHistoryEntry(
  ownerKey: string,
  entry: StatusHistoryEntry,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO status_history
      (id, owner_key, expediente, status, status_label, last_movement_date, snapshot_json, recorded_at)
     VALUES (@id, @owner_key, @expediente, @status, @status_label, @last_movement_date, @snapshot_json, @recorded_at)`,
  ).run({
    id: entry.id,
    owner_key: ownerKey,
    expediente: entry.expediente,
    status: entry.status,
    status_label: entry.statusLabel,
    last_movement_date: entry.lastMovementDate,
    snapshot_json: JSON.stringify(entry.snapshot),
    recorded_at: entry.recordedAt,
  });

  // Cap history growth per mark
  const overflow = db
    .prepare(
      `SELECT id FROM status_history
       WHERE owner_key = ? AND expediente = ?
       ORDER BY recorded_at DESC
       LIMIT -1 OFFSET ?`,
    )
    .all(ownerKey, entry.expediente, MAX_HISTORY_PER_MARK) as { id: string }[];
  if (overflow.length) {
    const del = db.prepare(`DELETE FROM status_history WHERE id = ?`);
    for (const row of overflow) del.run(row.id);
  }
}

export function listHistory(
  ownerKey: string,
  expediente: string,
  limit = 20,
): StatusHistoryEntry[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM status_history
       WHERE owner_key = ? AND expediente = ?
       ORDER BY recorded_at DESC LIMIT ?`,
    )
    .all(ownerKey, expediente, Math.min(limit, MAX_HISTORY_PER_MARK)) as Record<
    string,
    unknown
  >[];
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

function pruneNotifications(ownerKey: string): void {
  const db = getDb();
  const overflow = db
    .prepare(
      `SELECT id FROM notifications
       WHERE owner_key = ?
       ORDER BY created_at DESC
       LIMIT -1 OFFSET ?`,
    )
    .all(ownerKey, MAX_NOTIFICATIONS_PER_OWNER) as { id: string }[];
  if (!overflow.length) return;
  const del = db.prepare(`DELETE FROM notifications WHERE id = ?`);
  for (const row of overflow) del.run(row.id);
}

export function addNotification(
  ownerKey: string,
  notification: Omit<AppNotification, "read"> & { read?: boolean },
): AppNotification {
  const db = getDb();
  const full: AppNotification = {
    ...notification,
    read: notification.read ?? false,
  };
  db.prepare(
    `INSERT INTO notifications
      (id, owner_key, expediente, kind, title, body, created_at, read)
     VALUES (@id, @owner_key, @expediente, @kind, @title, @body, @created_at, @read)`,
  ).run({
    id: full.id,
    owner_key: ownerKey,
    expediente: full.expediente,
    kind: full.kind,
    title: full.title,
    body: full.body,
    created_at: full.createdAt,
    read: full.read ? 1 : 0,
  });
  pruneNotifications(ownerKey);
  return full;
}

export function listNotifications(
  ownerKey: string,
  options?: { unreadOnly?: boolean; limit?: number },
): AppNotification[] {
  const db = getDb();
  const limit = Math.min(options?.limit ?? 50, MAX_NOTIFICATIONS_PER_OWNER);
  const rows = (
    options?.unreadOnly
      ? db
          .prepare(
            `SELECT * FROM notifications
             WHERE owner_key = ? AND read = 0
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(ownerKey, limit)
      : db
          .prepare(
            `SELECT * FROM notifications
             WHERE owner_key = ?
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(ownerKey, limit)
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

export function markNotificationRead(ownerKey: string, id: string): boolean {
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE notifications SET read = 1 WHERE id = ? AND owner_key = ?`,
    )
    .run(id, ownerKey);
  return info.changes > 0;
}

export function markAllNotificationsRead(ownerKey: string): number {
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE notifications SET read = 1 WHERE owner_key = ? AND read = 0`,
    )
    .run(ownerKey);
  return info.changes;
}

export function listExpiringWithin(
  ownerKey: string,
  days: number,
): TrackedMark[] {
  const marks = listTrackedMarks(ownerKey).filter((m) => m.current?.expiryDate);
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
