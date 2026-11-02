import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface MeasurementInput {
  deviceId: string;
  measuredAt: string;
  userId: number;
  weightX100: number;
  resistance: number;
  fatPercentage: number;
  historical: boolean;
  firmwareVersion: number;
  receivedAt: string;
}

export interface MeasurementRow {
  id: number;
  deviceId: string;
  scaleDate: number;
  userId: number;
  weightX100: number;
  resistance: number;
  fatPercentage: number;
  historical: boolean;
  firmwareVersion: number | null;
  receivedAt: string;
}

export interface DeviceRow {
  id: string;
  lastSeenAt: string;
  firmwareVersion: number | null;
}

export interface MeasurementFilter {
  from?: string;
  to?: string;
  userId?: number;
  limit: number;
  before?: string;
}

export interface MeasurementStore {
  insert(input: MeasurementInput): boolean;
  list(filter: MeasurementFilter): MeasurementRow[];
  latest(userId?: number): MeasurementRow | null;
  devices(): DeviceRow[];
  /** Delete every measurement and return how many rows were removed. */
  clear(): number;
  ping(): boolean;
  close(): void;
}

interface DbMeasurementRow {
  id: number;
  device_id: string;
  scale_date: number;
  user_id: number;
  weight_x100: number;
  resistance: number;
  fat_percentage: number;
  historical: number;
  firmware_version: number | null;
  received_at: string;
}

interface DbDeviceRow {
  id: string;
  last_seen_at: string;
  firmware_version: number | null;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  last_seen_at TEXT NOT NULL,
  firmware_version INTEGER
);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices (id),
  scale_date INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  weight_x100 INTEGER NOT NULL,
  resistance INTEGER NOT NULL DEFAULT 0,
  fat_percentage INTEGER NOT NULL DEFAULT 0,
  historical INTEGER NOT NULL DEFAULT 0,
  firmware_version INTEGER,
  received_at TEXT NOT NULL,
  UNIQUE (device_id, scale_date, user_id, weight_x100)
);

CREATE INDEX IF NOT EXISTS idx_measurements_device_date
  ON measurements (device_id, scale_date DESC);
CREATE INDEX IF NOT EXISTS idx_measurements_user_date
  ON measurements (user_id, scale_date DESC);
`;

function epochSeconds(iso: string): number {
  const milliseconds = Date.parse(iso);
  if (Number.isNaN(milliseconds)) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  return Math.floor(milliseconds / 1000);
}

function toMeasurementRow(row: DbMeasurementRow): MeasurementRow {
  return {
    id: row.id,
    deviceId: row.device_id,
    scaleDate: row.scale_date,
    userId: row.user_id,
    weightX100: row.weight_x100,
    resistance: row.resistance,
    fatPercentage: row.fat_percentage,
    historical: row.historical === 1,
    firmwareVersion: row.firmware_version,
    receivedAt: row.received_at,
  };
}

export class SqliteStore implements MeasurementStore {
  private readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new Database(path);
    this.db.exec(SCHEMA);
  }

  insert(input: MeasurementInput): boolean {
    const scaleDate = epochSeconds(input.measuredAt);

    this.db
      .prepare(
        `INSERT INTO devices (id, last_seen_at, firmware_version)
         VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           last_seen_at = excluded.last_seen_at,
           firmware_version = excluded.firmware_version`
      )
      .run(input.deviceId, input.receivedAt, input.firmwareVersion);

    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO measurements (
           device_id, scale_date, user_id, weight_x100, resistance,
           fat_percentage, historical, firmware_version, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.deviceId,
        scaleDate,
        input.userId,
        input.weightX100,
        input.resistance,
        input.fatPercentage,
        input.historical ? 1 : 0,
        input.firmwareVersion,
        input.receivedAt
      );

    return Number(result.changes) > 0;
  }

  list(filter: MeasurementFilter): MeasurementRow[] {
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (filter.from) {
      where.push("scale_date >= ?");
      params.push(epochSeconds(filter.from));
    }
    if (filter.to) {
      where.push("scale_date <= ?");
      params.push(epochSeconds(filter.to));
    }
    if (filter.userId !== undefined) {
      where.push("user_id = ?");
      params.push(filter.userId);
    }
    if (filter.before) {
      where.push("scale_date < ?");
      params.push(epochSeconds(filter.before));
    }

    const sql = `SELECT id, device_id, scale_date, user_id, weight_x100,
                        resistance, fat_percentage, historical, firmware_version,
                        received_at
                 FROM measurements
                 ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY scale_date DESC, id DESC
                 LIMIT ?`;
    params.push(filter.limit);

    const rows = this.db.prepare(sql).all(...params) as DbMeasurementRow[];
    return rows.map(toMeasurementRow);
  }

  latest(userId?: number): MeasurementRow | null {
    const sql = `SELECT id, device_id, scale_date, user_id, weight_x100,
                        resistance, fat_percentage, historical, firmware_version,
                        received_at
                 FROM measurements
                 ${userId === undefined ? "" : "WHERE user_id = ?"}
                 ORDER BY scale_date DESC, id DESC
                 LIMIT 1`;

    const row = (
      userId === undefined
        ? this.db.prepare(sql).get()
        : this.db.prepare(sql).get(userId)
    ) as DbMeasurementRow | null;

    return row ? toMeasurementRow(row) : null;
  }

  devices(): DeviceRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, last_seen_at, firmware_version
         FROM devices
         ORDER BY last_seen_at DESC`
      )
      .all() as DbDeviceRow[];

    return rows.map((row) => ({
      id: row.id,
      lastSeenAt: row.last_seen_at,
      firmwareVersion: row.firmware_version,
    }));
  }

  clear(): number {
    const result = this.db.prepare("DELETE FROM measurements").run();
    return Number(result.changes);
  }

  ping(): boolean {
    try {
      this.db.prepare("SELECT 1 AS ok").get();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.db.close();
  }
}
