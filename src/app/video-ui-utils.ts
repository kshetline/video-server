import { LibraryItem, VType } from '../../server/src/shared-types';
import { stripDiacriticals_lc } from '@tubular/util';

let imageIndex = 0;

export function getImageParam(): string {
  return imageIndex > 0 ? '&ii=' + imageIndex : '';
}

export function incrementImageIndex(): number {
  return ++imageIndex;
}

// noinspection DuplicatedCode
export function checksum53(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;

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
  const name = item.originalName ?? item.name;

  if (!item)
    return '';
  else if (item?.type === VType.MOVIE)
    return name;
  else if (item?.type === VType.TV_SEASON && item.parent?.name &&
           stripDiacriticals_lc(name).includes(stripDiacriticals_lc(item.parent.name)))
    return name;

  let title = getTitle(item);
  const baseSeason = name.trim();
  let season = baseSeason;
  const innerTitle = item.data && item.data[0] && item.data[0].data && item.data[0].data[0] && item.data[0].data[0].title;
  const $ = /^([^•]+)/.exec(innerTitle);

  if (item.type === VType.TV_SEASON && !/\bMiniseries|Season\b/i.test(season) && item.season)
    season += ` (Season ${item.season})`;

  if ($ && !$[1].includes('/'))
    title = $[1].trim();

  if (title && season && stripDiacriticals_lc(title) !== stripDiacriticals_lc(baseSeason))
    return `${title} • ${season}`;
  else if (title)
    return title;
  else
    return season || '';
}

export function getZIndex(elem: Element): number {
  do {
    const index = parseInt(getComputedStyle(elem).getPropertyValue('z-index'));

    if (!isNaN(index))
      return index;
  } while ((elem = elem.parentElement));

  return 0;
}

export function hashTitle(title: string): string {
  return title ? checksum53(title.toLowerCase()) : '';
}

let videoSupportChecked = false;
let supportsVP9 = false;

export function canPlayVP9(): boolean {
  if (!videoSupportChecked) {
    const video = document.createElement('video');

    if (video.canPlayType('video/webm; codecs="vp9, vorbis"'))
      supportsVP9 = true;

    videoSupportChecked = true;
  }

  return supportsVP9;
}

// noinspection DuplicatedCode
function sortForm(s: string): string {
  let $ = /^((A|An|The)\s+)(.*)$/.exec(s);

  if ($)
    s = $[3] + ', ' + $[2];

  $ = /^(\d+)\b(.*)$/.exec(s);

  if ($)
    s = $[1].padStart(8, '0') + $[2];

  return s;
}

const comparator = new Intl.Collator('en', { caseFirst: 'upper' }).compare;

// noinspection DuplicatedCode
export function librarySorter(a: LibraryItem, b: LibraryItem): number {
  const sa = sortForm(a.name);
  const sb = sortForm(b.name);

  return comparator(sa, sb);
}
