import { Request, Response } from 'express';
import { lstat, readFile, readlink, unlink } from 'fs/promises';
import { existsSync, mkdirSync, readFileSync, Stats } from 'fs';
import paths from 'path';
import { LibraryItem } from './shared-types';
import { asLines } from '@tubular/util';

const guestFilter = new Set(process.env.VS_GUEST_FILTER ? process.env.VS_GUEST_FILTER.split(';') : []);
const demoFilter = new Set(process.env.VS_DEMO_FILTER ? process.env.VS_DEMO_FILTER.split(';') : []);

export const cacheDir = paths.join(process.cwd(), 'cache');
export const thumbnailDir = paths.join(cacheDir, 'thumbnail');

const vSource = process.env.VS_VIDEO_SOURCE;
let linkLookup = new Map<string, string>();

if (process.platform === 'win32' || process.platform === 'darwin') {
  const lines = asLines(readFileSync(paths.join(vSource, 'symlinks.txt'), 'utf8').toString());

  linkLookup = new Map();

  for (let i = 0; i < lines.length - 1; i += 2) {
    const link = paths.join(vSource, lines[i].substring(2).replace(/\//g, paths.sep));
    const target = paths.join(vSource, lines[i + 1].replace(/^\.\.\//g, '').replace('/', paths.sep));

    linkLookup.set(link, target);
  }
}

for (const dir of [
  cacheDir, thumbnailDir,
  paths.join(cacheDir, 'poster'), paths.join(thumbnailDir, 'poster'),
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

export async function safeReadLink(path: string): Promise<string> {
  if (linkLookup)
    return linkLookup.get(path);

  try {
    return await readlink(path);
  }
  catch {
    try {
      return (await readFile(path)).toString();
    }
    catch {}
  }

  return '???';
}

export async function safeLstat(path: string): Promise<Stats | null> {
  try {
    const stat = await lstat(path);

    if (linkLookup.has(path))
      stat.isSymbolicLink = (): boolean => true;

    return stat;
  }
  catch (e) {
    if (e.code !== 'ENOENT')
      throw e;
  }

  return null;
}

// noinspection DuplicatedCode
export function checksum53(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;

  for (let i = 0, ch: number; i < s.length; ++i) {
    ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).toUpperCase().padStart(14, '0');
}

export async function deleteIfPossible(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  }
  catch {}

  return false;
}

export function hashTitle(title: string): string {
  return title ? checksum53(title.toLowerCase()) : '';
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
