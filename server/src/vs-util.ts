import { Request, Response } from 'express';
import { lstat, open, unlink, utimes } from 'fs/promises';
import { existsSync, mkdirSync, Stats } from 'fs';
import paths from 'path';
import { LibraryItem } from './shared-types';
import { hashTitle } from './shared-utils';
import { WebSocketServer } from 'ws';
import { asLines, isObject, isString } from '@tubular/util';
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
        while (path && path !== '/') {
          path = paths.dirname(path);
          countsByPath.set(path, (countsByPath.get(path) || 0) + 1);
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
