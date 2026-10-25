import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { SnapshotSchema, SettingsSchema, type Snapshot, type Settings } from "../shared/models.js";
import { defaultSettings, demoSnapshot } from "./demo.js";

function dataDirectory() {
  if (process.env.SORTFRAME_DATA_DIR) return process.env.SORTFRAME_DATA_DIR;
  const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return join(base, "Sortframe");
}

const directory = dataDirectory();
mkdirSync(directory, { recursive: true });
export const db = new DatabaseSync(join(directory, "sortframe.sqlite"));
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);");

const getStatement = db.prepare("SELECT value FROM state WHERE key = ?");
const setStatement = db.prepare("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
export function readCache<T>(key: string): T | undefined {
  const result = getStatement.get(`cache:${key}`) as { value: string } | undefined;
  if (!result) return undefined;
  try { return JSON.parse(result.value) as T; } catch { return undefined; }
}
export function writeCache(key: string, value: unknown) {
  setStatement.run(`cache:${key}`, JSON.stringify(value));
}
function getValue<T>(key: string, parse: (input: unknown) => T, fallback: T): T {
  const result = getStatement.get(key) as { value: string } | undefined;
  if (!result) return fallback;
  try { return parse(JSON.parse(result.value)); } catch { return fallback; }
}
function setValue(key: string, value: unknown) {
  setStatement.run(key, JSON.stringify(value));
}

export function loadSnapshot(): Snapshot {
  return getValue("snapshot", (value) => SnapshotSchema.parse(value), demoSnapshot());
}
export function saveSnapshot(value: Snapshot) {
  const snapshot = SnapshotSchema.parse(value);
  setValue("snapshot", snapshot);
  return snapshot;
}
export function loadSettings(): Settings {
  return getValue("settings", (value) => SettingsSchema.parse(value), defaultSettings);
}
export function saveSettings(value: unknown) {
  const settings = SettingsSchema.parse(value);
  setValue("settings", settings);
  return settings;
}
