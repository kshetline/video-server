import { LibraryItem, VideoLibrary, VType } from './shared-types';
import { clone, isArray, isObject } from '@tubular/util';

export function isAnyCollection(x: LibraryItem | number): boolean {
  if (isObject(x))
    x = x?.type;

  return x === VType.COLLECTION || x === VType.TV_COLLECTION;
}

export function isCollection(x: LibraryItem | number): boolean {
  return (isObject(x) ? x?.type : x) === VType.COLLECTION;
}

export function isFile(x: LibraryItem | number): boolean {
  return (isObject(x) ? x?.type : x) === VType.FILE;
}

export function isMovie(x: LibraryItem | number): boolean {
  return (isObject(x) ? x?.type : x) === VType.MOVIE;
}

export function isTvCollection(x: LibraryItem | number): boolean {
  return (isObject(x) ? x?.type : x) === VType.TV_COLLECTION;
}

export function isTvEpisode(x: LibraryItem | number): boolean {
  return (isObject(x) ? x?.type : x) === VType.TV_EPISODE;
}

export function isTvSeason(x: LibraryItem | number): boolean {
  return (isObject(x) ? x?.type : x) === VType.TV_SEASON;
}

export function isTvShow(x: LibraryItem | number): boolean {
  return (isObject(x) ? x?.type : x) === VType.TV_SHOW;
}

export function checksum53(s: string, seed = 0): string {
  let h1 = 0xDEADBEEF ^ seed;
  let h2 = 0x41C6CE57 ^ seed;

  s = s.normalize();

  for (let i = 0, ch: number; i < s.length; ++i) {
    ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).toUpperCase().padStart(14, '0');
}

export function hashTitle(title: string): string {
  return title ? checksum53(title.toLowerCase()) : '';
}

function sortForm(s: string): string {
  let $ = /^((A|An|The)\s+)(.*)$/.exec(s);

  if ($)
    s = $[3] + '\t' + $[2];

  $ = /^(\d+)\b(.*)$/.exec(s);

  if ($)
    s = $[1].padStart(8, '0') + $[2];

  return s;
}

export const comparator = new Intl.Collator('en', { caseFirst: 'upper' }).compare;

export function sorter(a: string, b: string): number {
  return comparator(sortForm(a), sortForm(b));
}

export function librarySorter(a: LibraryItem, b: LibraryItem): number {
  const sa = sortForm(a.name).split('\t');
  const sb = sortForm(b.name).split('\t');

  for (let i = 0; i < sa.length && i < sb.length; ++i) {
    const diff = comparator(sa[i], sb[i]);

    if (diff !== 0)
      return diff;
  }

  return sa.length - sb.length;
}

export function toStreamPath(s: string, volumeBase?: string, streamBase?: string): string {
  let parent = '';
  const $ = /^(.*[\\/])(.*)$/.exec(s);

  if ($) {
    parent = $[1];
    s = $[2];

    if (volumeBase && streamBase && parent.startsWith(volumeBase))
      parent = streamBase + parent.substring(volumeBase.length);
  }

  s = s.replace(/(\.mkv)$/i, '').replace(/\s*\([234][DK]\)(?=\(|$)/, '').replace(/(?<=\()\d+(?=#.*\))/, '')
    .replace(/#/g, '_').replace(/[-_][234][DK](?=\))/, '').replace('()', '');

  return parent + s;
}

export function characterToProgress(ch: string): number {
  if (ch <= '9')
    return 3.57;
  else if (ch >= 'A')
    return (ch.toString().charCodeAt(0) - 63) * 3.57;
  else
    return -1;
}

export function ts(): string {
  return new Date().toISOString().slice(0, -5).replace('T', ' ');
}

export function hashUrl(uri: string): string {
  return checksum53(uri.replace(/^\//, '').normalize());
}

export function nie<T>(array: T[]): T[] | null {
  if (array && isArray(array) && array.length > 0)
    return array;
  else
    return null;
}

export function findAliases(id: number, itemOrLib?: LibraryItem | VideoLibrary, matches: LibraryItem[] = []): LibraryItem[] {
  const item: LibraryItem = (itemOrLib as any).array ? null : itemOrLib as LibraryItem;

  if (item?.id === id && item?.isAlias)
    matches.push(item);

  const data = item ? item.data : (itemOrLib as VideoLibrary)?.array;

  if (data) {
    for (const child of data) {
      const match = findAliases(id, child, matches);

      if (match)
        return match;
    }
  }

  return matches;
}

export function syncValues(src: LibraryItem, tar: LibraryItem): void {
  const fields = ['watched', 'watchedByUser', 'position', 'lastUserWatchTime'];

  for (const field of fields) {
    if ((src as any)[field] != null)
      (tar as any)[field] = (src as any)[field];
  }

  if (src.data && src.data.length === tar.data?.length) {
    for (let i = 0; i < src.data.length; ++i)
      syncValues(src.data[i], tar.data[i]);
  }
}

export function itemPath(item: LibraryItem): number[] {
  return !item ? [] : [...itemPath(item.parent), item.id];
}

export function addBackLinks(children: LibraryItem[], parent?: LibraryItem): void {
  if (!children)
    return;

  for (const child of children || []) {
    if (parent)
      child.parent = parent;

    if (child.data)
      addBackLinks(child.data, child);
  }
}

export function removeBackLinks(childrenOrLibOrItem: VideoLibrary | LibraryItem | LibraryItem[]): void {
  let children: LibraryItem[] = [];

  if (!childrenOrLibOrItem)
    return;
  else if ((childrenOrLibOrItem as VideoLibrary).array)
    children = (childrenOrLibOrItem as VideoLibrary).array;
  else if (!isArray(childrenOrLibOrItem)) {
    removeBackLinks([childrenOrLibOrItem as LibraryItem]);
    return;
  }
  else
    children = childrenOrLibOrItem as LibraryItem[];

  for (const child of children) {
    delete child.parent;

    if (child.data)
      removeBackLinks(child.data);
  }
}

export interface WatchInfo {
  counts?: {
    watched: number;
    unwatched: number;
  },
  duration: number;
  incomplete: boolean;
  mixed: boolean;
  position: number;
  stream?: string;
  watched: boolean;
}

export function getWatchInfo(asAdmin: boolean, item: LibraryItem, wi?: WatchInfo, unique = true): WatchInfo {
  let atTop = false;

  if (!wi) {
    atTop = true;
    wi = {
      counts: { watched: 0, unwatched: 0 },
      duration: 0,
      incomplete: false,
      mixed: false,
      position: 0,
      watched: false
    };
  }

  if (!asAdmin && item.streamUri && !wi.stream) {
    wi.stream = item.streamUri;
    wi.duration = item.duration / 1000;
  }

  const priorCounts = clone(wi.counts);
  let watched = false;

  if (item.duration != null && ((asAdmin && isFile(item)) || item.streamUri)) {
    watched = asAdmin ? item.watched : item.watchedByUser;
    wi.counts.watched += watched && unique ? 1 : 0;
    wi.counts.unwatched += watched ? 0 : 1;
  }

  let videoCount = 1;

  if (item.data) {
    const uniqueVideos = new Map<string, number>();

    videoCount = item.data.length;
    item.data.forEach(i => {
      const path = i.streamUri || i.uri?.replace('/2K/', '/');
      const newPath = path && !uniqueVideos.has(path);
      const lastCount = wi.counts.watched;

      if (newPath)
        uniqueVideos.set(path, 0);

      getWatchInfo(asAdmin, i, wi, !path || newPath || uniqueVideos.get(path) === 0);

      if (path)
        uniqueVideos.set(path, wi.counts.watched > lastCount ? 1 : 0)
    });

    if (uniqueVideos.size > 0 && uniqueVideos.size < videoCount)
      videoCount = uniqueVideos.size;
  }

  if (atTop) {
    wi.watched = (wi.counts.watched > 0);
    wi.incomplete = (wi.counts.watched > 0 && wi.counts.watched < videoCount && wi.counts.unwatched > 0);
    wi.mixed = wi.incomplete && !isMovie(item);
    delete wi.counts;
  }
  else if (wi.counts.watched > priorCounts.watched && isMovie(item)) {
    wi.counts.watched = priorCounts.watched + videoCount;
    wi.counts.unwatched = priorCounts.unwatched;
  }

  return wi;
}
