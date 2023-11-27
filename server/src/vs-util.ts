import { Request, Response } from 'express';
import { lstat, open, unlink, utimes } from 'fs/promises';
import { existsSync, mkdirSync, Stats } from 'fs';
import paths from 'path';
import { LibraryItem } from './shared-types';
import { hashTitle } from './shared-utils';

const guestFilter = new Set(process.env.VS_GUEST_FILTER ? process.env.VS_GUEST_FILTER.split(';') : []);
const demoFilter = new Set(process.env.VS_DEMO_FILTER ? process.env.VS_DEMO_FILTER.split(';') : []);

export const cacheDir = paths.join(process.cwd(), 'cache');
export const thumbnailDir = paths.join(cacheDir, 'thumbnail');

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

const charsNeedingRegexEscape = /[-[\]/{}()*+?.\\^$|]/g;

export function escapeForRegex(s: string): string {
  return s.replace(charsNeedingRegexEscape, '\\$&');
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

export function itemAccessAllowed(item: LibraryItem, role: string): boolean {
  const filters = [guestFilter];

  if (role === 'demo')
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
