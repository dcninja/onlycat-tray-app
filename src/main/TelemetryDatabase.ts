import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

let SQL: any = null;
let db: any = null;

const DB_PATH = () => path.join(app.getPath('userData'), 'telemetry.db');
const WASM_PATH = () => path.join(__dirname, '../../../node_modules/sql.js/dist/sql-wasm.wasm');

export interface TelemetryPoint {
  timestamp: string;
  deviceId: string;
  measureName: string;
  value: number;
}

async function getDb(): Promise<any> {
  if (db) return db;

  if (!SQL) {
    const initSqlJs = require('sql.js');
    SQL = await initSqlJs({
      locateFile: () => WASM_PATH(),
    });
  }

  const dbPath = DB_PATH();
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      deviceId TEXT NOT NULL,
      measureName TEXT NOT NULL,
      value REAL NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_telemetry_device_measure_time
    ON telemetry (deviceId, measureName, timestamp)
  `);

  return db;
}

function persist(): void {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH(), Buffer.from(data));
}

export async function saveTelemetry(points: TelemetryPoint[]): Promise<void> {
  const database = await getDb();
  const stmt = database.prepare(`
    INSERT INTO telemetry (timestamp, deviceId, measureName, value)
    VALUES (?, ?, ?, ?)
  `);

  for (const point of points) {
    stmt.run([point.timestamp, point.deviceId, point.measureName, point.value]);
  }
  stmt.free();
  persist();
}

export async function getTelemetry(
  deviceId: string,
  measureName: string,
  since?: string
): Promise<TelemetryPoint[]> {
  const database = await getDb();
  const query = since
    ? `SELECT timestamp, deviceId, measureName, value FROM telemetry WHERE deviceId = ? AND measureName = ? AND timestamp >= ? ORDER BY timestamp ASC`
    : `SELECT timestamp, deviceId, measureName, value FROM telemetry WHERE deviceId = ? AND measureName = ? ORDER BY timestamp ASC`;

  const params = since ? [deviceId, measureName, since] : [deviceId, measureName];
  const result = database.exec(query, params);
  if (!result.length) return [];

  return result[0].values.map((row: any[]) => ({
    timestamp: row[0] as string,
    deviceId: row[1] as string,
    measureName: row[2] as string,
    value: row[3] as number,
  }));
}

export async function getLatestTelemetry(deviceId: string): Promise<TelemetryPoint[]> {
  const database = await getDb();
  const result = database.exec(`
    SELECT t1.timestamp, t1.deviceId, t1.measureName, t1.value
    FROM telemetry t1
    INNER JOIN (
      SELECT measureName, MAX(timestamp) as maxTs
      FROM telemetry
      WHERE deviceId = ?
      GROUP BY measureName
    ) t2 ON t1.measureName = t2.measureName AND t1.timestamp = t2.maxTs
    WHERE t1.deviceId = ?
  `, [deviceId, deviceId]);

  if (!result.length) return [];
  return result[0].values.map((row: any[]) => ({
    timestamp: row[0] as string,
    deviceId: row[1] as string,
    measureName: row[2] as string,
    value: row[3] as number,
  }));
}

/** Prune telemetry older than the given number of days */
export async function pruneTelemetry(daysToKeep: number = 30): Promise<void> {
  const database = await getDb();
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
  database.run(`DELETE FROM telemetry WHERE timestamp < ?`, [cutoff]);
  persist();
}
