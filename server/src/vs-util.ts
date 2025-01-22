import { Request, Response } from 'express';
import { lstat, open, unlink, utimes } from 'fs/promises';
import { existsSync, mkdirSync, Stats } from 'fs';
import paths from 'path';
import { LibraryItem } from './shared-types';
import { hashTitle } from './shared-utils';
import { WebSocketServer } from 'ws';
import { asLines, isArray, isObject, isString, toInt } from '@tubular/util';
import { getDb } from './settings';
import { setEncodeProgress } from './admin-router';
import { cacheDir, thumbnailDir } from './shared-values';
import { spawn } from 'child_process';
import { linuxEscape } from './process-util';

const guestFilter = new Set(process.env.VS_GUEST_FILTER ? process.env.VS_GUEST_FILTER.split(';') : []);
const demoFilter = new Set(process.env.VS_DEMO_FILTER ? process.env.VS_DEMO_FILTER.split(';') : []);

for (const dir of [
  cacheDir, thumbnailDir,
  paths.join(cacheDir, 'poster'), paths.join(thumbnailDir, 'poster'),
  paths.join(cacheDir, 'profile'), paths.join(thumbnailDir, 'profile'),
  paths.join(cacheDir, 'backdrop'),
  paths.join(cacheDir, 'logo')
]) {
  if (!existsSync(dir))
    mkdirSync(dir);
}

let wsServer: WebSocketServer;

export function setWebSocketServer(wss: WebSocketServer): void {
  wsServer = wss;
}

export function webSocketSend(message: string | object): void {
  if (isObject(message)) {
    switch (message.type) {
      case 'audio-progress':
        setEncodeProgress(message.data ? 'Audio: ' + message.data : ''); break;
      case 'video-progress':
        setEncodeProgress(message.data); break;
    }

    message = JSON.stringify(message);
  }

  if (wsServer)
    wsServer.clients.forEach(client => client.send(message as string));
}

export function noCache(res: Response): void {
  res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.header('Expires', '-1');
  res.header('Pragma', 'no-cache');
}

export function jsonOrJsonp(req: Request, res: Response, data: any): void {
  if (req.query.callback)
    res.jsonp(data);
  else
    res.json(data);
}

/**
 * Normalize a port into a number, string, or false.
 */
export function normalizePort(val: number | string): string | number | false {
  const port = parseInt(val as string, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

export function timeStamp(): string {
  return '[' + new Date().toISOString() + ']';
}

export function unref(timer: any): any {
  if (timer?.unref)
    timer.unref();

  return timer;
}

export async function existsAsync(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  }
  catch (e) {
    if (e.code !== 'ENOENT')
      throw e;
  }

  return false;
}

export async function safeLstat(path: string): Promise<Stats | null> {
  if (!path)
    return null;

  try {
    return await lstat(path);
  }
  catch (e) {
    if (e.code !== 'ENOENT')
      throw e;
  }

  return null;
}

export async function safeUnlink(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  }
  catch (e) {
    if (e.code !== 'ENOENT')
      throw e;
  }

  return false;
}

export async function deleteIfPossible(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  }
  catch {}

  return false;
}

export function role(req: any): 'admin' | 'demo' | 'guest' {
  return req.user?.role;
}

export function isAdmin(req: any): boolean {
  return req.user?.role === 'admin';
}

export function isDemo(req: any): boolean {
  return req.user?.role === 'demo';
}

export function username(req: any): string {
  return req.user?.name;
}

export function itemAccessAllowed(item: LibraryItem, role: string): boolean {
  const filters = [guestFilter];

  if (isDemo(role))
    filters.push(demoFilter);

  for (const filter of filters) {
    if (filter.has(item.name?.toLowerCase()) || filter.has(hashTitle(item.name)))
      return false;
  }

  return true;
}

export async function touch(path: string, newIfNonexistent = true): Promise<void> {
  const now = new Date();

  try {
    await utimes(path, now, now);
  }
  catch (e) {
    if (!newIfNonexistent || e.code !== 'ENOENT')
      throw e;

    await (await open(path, 'a')).close();
  }
}

export function getRemoteAddress(req: Request): string {
  return ((req.headers['x-real-ip'] as string) ||
    (req.headers['x-forwarded-for'] as string) ||
    req.socket.remoteAddress || '').replace(/.*:/, '');
}

export async function watched(video: string, user: string): Promise<boolean>;
export async function watched(time: number, duration: number, video?: string, user?: string): Promise<boolean>;
export async function watched(timeOrVideo: number | string, durationOrUser?: number | string,
                        video?: string, user?: string): Promise<boolean> {
  let time = 0;
  let duration = 0;
  let wasWatched = false;

  if (isString(timeOrVideo))
    video = timeOrVideo;
  else
    time = timeOrVideo;

  if (isString(durationOrUser))
    user = durationOrUser;
  else
    duration = durationOrUser;

  if (video && user)
    wasWatched =
      !!((await getDb().get('SELECT watched FROM watched WHERE video = ? AND user = ?', video, user)) as any)?.watched;

  if (wasWatched || time >= duration - 1)
    return true;

  const percent = time * 100 / duration;

  return time >= 3600 && percent > 93 || percent > 95;
}

export function getIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || (req as any).connection?.remoteAddress || (req as any).connection?.socket?.remoteAddress;
}

export async function getRemoteFileCounts(): Promise<Map<string, number>> {
  const ssh = spawn('ssh', [process.env.VS_VIDEO_SOURCE_SSH]);
  const root = process.env.VS_VIDEO_SOURCE_ROOT;

  ssh.stdin.write(`find ${linuxEscape(root)} -name "*.mkv" -o -name "*.iso" | sort\n`);
  ssh.stdin.write('exit\n');
  ssh.stdin.end();

  return new Promise<Map<string, number>>((resolve, _reject) => {
    let content = '';

    ssh.stdout.on('data', data => content += data.toString());

    ssh.on('close', () => {
      const countsByPath: Map<string, number> = new Map();
      const files = asLines(content.normalize()).map(p => p.substring(root.length));

      for (let path of files) {
        const isExtra = /\/(_Extras_|_Bonus)\b/.test(path);

        while (path && path !== '/') {
          path = paths.dirname(path);
          countsByPath.set(path, (countsByPath.get(path) || 0) + 1);

          if (path === '/' && !isExtra)
            countsByPath.set('*', (countsByPath.get('*') || 0) + 1);
        }
      }

      resolve(countsByPath);
    });

    ssh.stderr.on('error', err => {
      console.error(err);
      resolve(null);
    });

    ssh.on('error', err => {
      console.error(err);
      resolve(null);
    });
  });
}

export function unescapeBash(s: string): string {
  return s.replace(/\\(.)/g, (_match, p1) => {
    switch (p1) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case '\\': return '\\';
      case '"': return '"';
      case "'": return "'";
      default: return p1;
    }
  });
}

export interface DirectoryEntry {
  name: string;
  isDir: boolean;
  isLink: boolean;
  size: number;
  mdate: Date;
  children?: DirectoryEntry[];
}

enum DirState { AT_DIRECTORY, AT_TOTAL, AT_ENTRY }

export async function getRemoteRecursiveDirectory(streaming = false): Promise<DirectoryEntry[]> {
  const ssh = spawn('ssh', [process.env.VS_VIDEO_SOURCE_SSH]);
  const root = streaming ? process.env.VS_STREAMING_SOURCE_ROOT : process.env.VS_VIDEO_SOURCE_ROOT;

  ssh.stdin.write(`ls -R --full-time ${linuxEscape(root)}\n`);
  ssh.stdin.write('exit\n');
  ssh.stdin.end();

  return new Promise<DirectoryEntry[]>((resolve, _reject) => {
    let content = '';

    ssh.stdout.on('data', data => content += (data as Buffer).toString('utf-8'));

    ssh.on('close', () => {
      const lines = asLines(content.normalize()).map(l => l.trim());
      const dirs = new Map<string, DirectoryEntry[]>();
      let state = DirState.AT_DIRECTORY;
      let top: DirectoryEntry[];
      let entries: DirectoryEntry[] = [];
      let dir = '';

      lines.push(''); // Make sure last list of entries gets processed

      for (const line of lines) {
        switch (state) {
          case DirState.AT_DIRECTORY:
            if (line) {
              dir = line.replace(/:$/, '').replace(/^.$/, '').substring(root.length).replace(/^\//, '');
              entries = dirs.get(dir) || [];
              state = DirState.AT_TOTAL;
            }

            break;

          case DirState.AT_TOTAL:
            if (line.startsWith('total'))
              state = DirState.AT_ENTRY;

            break;

          case DirState.AT_ENTRY:
            if (!line) {
              state = DirState.AT_DIRECTORY;

              if (!dir)
                top = entries;
            }
            else {
              // 55 2025-01-12 22:06:50.733115601 -0500
              const $ = /^(.).*\s+(\d+)\s+(\d\d\d\d-\d\d-\d\d \d\d:\d\d:\d\d\.\d+ [+-]\d\d\d\d)\s+(.*)$/.exec(line);

              if ($) {
                const entry = {
                  name: unescapeBash($[4]),
                  isDir: $[1] === 'd',
                  isLink: $[1] === 'l',
                  size: toInt($[2]),
                  mdate: new Date($[3])
                } as DirectoryEntry;

                if (entry.isLink)
                  entry.name = entry.name.replace(/ -> .*?$/, '');

                if (entry.isDir) {
                  entry.children = [];
                  dirs.set(paths.join(dir, entry.name), entry.children);
                }

                entries.push(entry);
              }
            }
        }
      }

      resolve(top);
    });

    ssh.stderr.on('error', err => {
      console.error(err);
      resolve(null);
    });

    ssh.on('error', err => {
      console.error(err);
      resolve(null);
    });
  });
}

export function pathToEntry(entries: DirectoryEntry[], path: string): DirectoryEntry {
  path = path.replace(/^\//, '');

  const name = (/^(.+?)\//.exec(path) || ['', path])[1];
  const match = entries?.find(e => e.name === name);

  if (!match)
    return null;

  path = path.substring(name.length + 1);

  if (!path)
    return match;
  else if (!match.isDir)
    return null;

  return pathToEntry(match.children, path);
}

export function pathExists(entries: DirectoryEntry[], path: string): boolean {
  return !!pathToEntry(entries, path);
}

export function fileCountFromEntry(entry: DirectoryEntry | DirectoryEntry[]): number {
  if (isArray(entry))
    entry = { name: '.', isDir: true, isLink: false, size: 0, children: entry, mdate: null };

  if (!entry?.children || !entry.isDir)
    return 0;

  let total = 0;

  for (const child of entry.children) {
    if (child.isDir)
      total += fileCountFromEntry(child);
    else if (/\.(iso|mkv)$/.test(child.name))
      ++total;
  }

  return total;
}
