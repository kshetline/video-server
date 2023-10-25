import { LibraryItem, VType } from '../../server/src/shared-types';
import { stripDiacriticals_lc } from '@tubular/util';

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

export function addBackLinks(children: LibraryItem[], parent?:LibraryItem): void {
  for (const child of children) {
    if (parent)
      child.parent = parent;

    if (child.data)
      addBackLinks(child.data, child);
  }
}

export function getTitle(item: LibraryItem, baseItem?: LibraryItem): string {
  if (!item)
    return '';
  else if (item.type === VType.MOVIE || item.type === VType.TV_SHOW)
    return item.name;
  else if (item.parent)
    return getTitle(item.parent, baseItem ?? item);
  else if (baseItem && baseItem.type !== VType.COLLECTION)
    return baseItem.name;
  else
    return '';
}

export function getSeasonTitle(item: LibraryItem): string {
  if (!item)
    return '';
  else if (item?.type === VType.MOVIE)
    return item.name;

  let title = getTitle(item);
  const season = item.name.trim();
  const innerTitle = item.data && item.data[0] && item.data[0].data && item.data[0].data[0] && item.data[0].data[0].title;
  const $ = /^([^•]+)/.exec(innerTitle);

  if ($ && !$[1].includes('/'))
    title = $[1].trim();

  if (title && season && stripDiacriticals_lc(title) !== stripDiacriticals_lc(season))
    return `${title} • ${season}`;
  else if (title)
    return title;
  else
    return season || '';
}
