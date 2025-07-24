import { AsyncDatabase } from 'promised-sqlite3';
import os from 'os';
import { toNumber } from '@tubular/util';
import { FFProbeInfo, MediaInfo, User } from './shared-types';
import crypto from 'crypto';
import { safeLstat } from './vs-util';
import { monitorProcess } from './process-util';
import { spawn } from 'child_process';
import { abs } from '@tubular/math';

let db: AsyncDatabase;

const isWindows = (os.platform() === 'win32');
const isMac = (os.platform() === 'darwin');

const defaults: Record<string, string> = {
  streamingDirectory: isWindows ? 'S:' : isMac ? '/Volumes/streaming' : '/mnt/streaming',
  videoDirectory: isWindows ? 'V:' : isMac ? '/Volumes/video' : '/mnt/video'
};
const settings: Record<string, string> = {};
export const users: User[] = [];

export function getDb(): AsyncDatabase {
  return db;
}

export async function openSettings(): Promise<void> {
  db = await AsyncDatabase.open(process.env.VS_DB_PATH || 'db.sqlite');

  await db.exec(
   `CREATE TABLE IF NOT EXISTS "aspects" (
      "key" TEXT NOT NULL UNIQUE,
      "mdate" REAL NOT NULL,
      "aspect" REAL,
      PRIMARY KEY ("key")
    )`);

  await db.exec(
   `CREATE TABLE IF NOT EXISTS "settings" (
      "key" TEXT NOT NULL UNIQUE,
      "value" TEXT,
      PRIMARY KEY("key")
    )`);

  await db.exec(
   `CREATE TABLE IF NOT EXISTS "validation" (
      "key" TEXT NOT NULL UNIQUE,
      "mdate" REAL NOT NULL,
      "error" TEXT,
      PRIMARY KEY ("key")
    )`);

  await db.exec(
   `CREATE TABLE IF NOT EXISTS "watched" (
      "user" TEXT NOT NULL,
      "video" TEXT NOT NULL,
      "duration" NUMERIC NOT NULL,
      "offset" NUMERIC NOT NULL,
      "watched" INTEGER NOT NULL,
      "last_watched" NUMERIC,
      PRIMARY KEY("user", "video")
    )`);

  await db.exec(
   `CREATE TABLE IF NOT EXISTS "logins" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "user" TEXT NOT NULL,
      "time" TEXT NOT NULL,
      "ip" TEXT NOT NULL,
      "bad_pw" TEXT
    )`);

  await db.exec(
   `CREATE TABLE IF NOT EXISTS "mediainfo" (
      "key" TEXT NOT NULL UNIQUE,
      "mdate" REAL NOT NULL,
      "json" TEXT,
      PRIMARY KEY ("key")
    )`);

  await db.each('SELECT * FROM settings', undefined, (row: any) =>
    settings[row.key] = row.value
  );

  await db.each('SELECT * FROM users', undefined, async (row: any) => {
    users.push({
      name: row.name,
      hash: await hashPassword(row.name, row.hash),
      role: row.role,
      time_to_expire: row.time_to_expire
    });
  });
}

export async function hashPassword(name: string, hash: string): Promise<string> {
  if (hash.length < 128) {
    hash = await new Promise((resolve, reject) =>
      crypto.pbkdf2(hash, process.env.VS_SALT, 100000, 64, 'sha512', (err, key) => {
        if (err)
          reject(err);
        else
          resolve(key.toString('hex'));
      }));

    return new Promise<string>(resolve => {
      db.run('UPDATE users SET hash = ? WHERE name = ?', hash, name).finally(() => resolve(hash));
    });
  }
  else
    return hash;
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

export async function getAugmentedMediaInfo(path: string, stripAugments = false, onlyFromDb = false): Promise<MediaInfo> {
  const stat = await safeLstat(path);
  const mdate = stat?.mtimeMs || 0;
  const key = path.substring(process.env.VS_VIDEO_SOURCE.length).replaceAll('\\', '/').replace(/^([^/])/, '/$1');
  const row = await db.get<any>('SELECT * FROM mediainfo WHERE key = ?', key);
  let mediainfo: MediaInfo;

  if (row && abs(row.mdate - mdate) < 1)
    mediainfo = JSON.parse(row.json);
  else if (onlyFromDb)
    return null;
  else {
    mediainfo = JSON.parse(await monitorProcess(spawn('mediainfo', [path, '--Output=JSON'])));
    const ffprobe = JSON.parse(await monitorProcess(spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json',
                                                                      '-show_streams', path]))) as FFProbeInfo;

    for (const track of mediainfo?.media?.track || []) {
      const match = ffprobe?.streams?.find(m => m.index === toNumber(track.ID) - 1);

      if (match) {
        track.comment = !!match.disposition?.comment;
        track.hearing_impaired = !!match.disposition?.hearing_impaired;
        track.original = !!match.disposition?.original;
        track.visual_impaired = !!match.disposition?.visual_impaired;
      }
    }

    await db.run('INSERT OR REPLACE INTO mediainfo (key, mdate, json) VALUES (?, ?, ?)', key, mdate,
        JSON.stringify(mediainfo));
  }

  // Always gather the augmented data so that the DB has it, but the client might not want it.
  if (stripAugments) {
    for (const track of mediainfo?.media?.track || []) {
      delete track.comment;
      delete track.hearing_impaired;
      delete track.original;
      delete track.visual_impaired;
    }
  }

  return mediainfo;
}
