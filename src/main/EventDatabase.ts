import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { DeviceEvent } from '../shared/types';

// sql.js uses WebAssembly — load it lazily
let SQL: any = null;
let db: any = null;

const DB_PATH = () => path.join(app.getPath('userData'), 'events.db');
const WASM_PATH = () => path.join(__dirname, '../../../node_modules/sql.js/dist/sql-wasm.wasm');

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

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      globalId INTEGER PRIMARY KEY,
      eventId INTEGER NOT NULL,
      deviceId TEXT NOT NULL,
      data TEXT NOT NULL,
      createdAt TEXT,
      storedAt INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  return db;
}

function persist(): void {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH(), Buffer.from(data));
}

export async function saveEvents(events: DeviceEvent[]): Promise<void> {
  const database = await getDb();
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO events (globalId, eventId, deviceId, data, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const event of events) {
    stmt.run([
      event.globalId,
      event.eventId,
      event.deviceId,
      JSON.stringify(event),
      event.createdAt ?? event.timestamp ?? null,
    ]);
  }
  stmt.free();
  persist();
}

export async function loadAllEvents(): Promise<DeviceEvent[]> {
  const database = await getDb();
  const result = database.exec(`SELECT data FROM events ORDER BY globalId DESC`);
  if (!result.length) return [];
  return result[0].values.map((row: any[]) => JSON.parse(row[0] as string));
}

export async function getLatestGlobalId(): Promise<number | null> {
  const database = await getDb();
  const result = database.exec(`SELECT MAX(globalId) FROM events`);
  if (!result.length || result[0].values[0][0] == null) return null;
  return result[0].values[0][0] as number;
}

export async function getEventCount(): Promise<number> {
  const database = await getDb();
  const result = database.exec(`SELECT COUNT(*) FROM events`);
  if (!result.length) return 0;
  return result[0].values[0][0] as number;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const database = await getDb();
  database.run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, value]);
  persist();
}

export async function getMeta(key: string): Promise<string | null> {
  const database = await getDb();
  const result = database.exec(`SELECT value FROM meta WHERE key = ?`, [key]);
  if (!result.length || !result[0].values.length) return null;
  return result[0].values[0][0] as string;
}
