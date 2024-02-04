import { AsyncDatabase } from 'promised-sqlite3';
import os from 'os';
import { toNumber } from '@tubular/util';

let db: AsyncDatabase;

const isWindows = (os.platform() === 'win32');
const isMac = (os.platform() === 'darwin');

const defaults: Record<string, string> = {
  streamingDirectory: isWindows ? 'S:' : isMac ? '/Volumes/streaming' : '/mnt/streaming',
  videoDirectory: isWindows ? 'V:' : isMac ? '/Volumes/video' : '/mnt/video'
};
const settings: Record<string, string> = {};

export async function openSettings(): Promise<void> {
  db = await AsyncDatabase.open(process.env.VS_DB_PATH || 'db.sqlite');

  await db.exec(
   `CREATE TABLE IF NOT EXISTS "settings" (
      "key" TEXT NOT NULL UNIQUE,
      "value" TEXT,
      PRIMARY KEY("key")
    )`);

  await db.each('SELECT * FROM settings', undefined, (row: any) =>
    settings[row.key] = row.value
  );
}

export async function closeSettings(): Promise<void> {
  if (db) {
    try {
      await db.close();
    }
    catch {}
  }
}

export function getValue(key: string): string {
  return settings[key] ?? defaults[key];
}

export function getNumber(key: string): number {
  return toNumber(getValue(key));
}

export function setValue(key: string, value: string | number): void {
  settings[key] = value?.toString();
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value).finally();
}
