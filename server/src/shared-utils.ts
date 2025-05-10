import { LibraryItem, VideoLibrary, VType } from './shared-types';
import { checksum53, clone, getOrSet, isArray, isObject, nfe, stripDiacriticals_lc } from '@tubular/util';

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

export function isMovieLike(item: LibraryItem): boolean {
  return item.isTvMovie || isMovie(item) ||
    (isCollection(item) && item.data?.length > 0 && !!item.data.find(i => isMovieLike(i)));
}

export function containsMovie(item: LibraryItem): boolean {
  if (isMovieLike(item))
    return true;
  else if (isTvCollection(item))
    return false;

  for (const child of (item.data || [])) {
    if (containsMovie(child))
      return true;
  }

  return false;
}

export function isTV(item: LibraryItem): boolean {
  return item.isTV || item.isTvMovie || isTvShow(item) || isTvSeason(item) ||
      isTvEpisode(item) || isTvCollection(item) ||
      (isCollection(item) && item.data?.length > 0 && !!item.data.find(i => isTV(i)));
}

export function containsTV(item: LibraryItem): boolean {
  if (isTV(item))
    return true;

  for (const child of (item.data || [])) {
    if (containsTV(child))
      return true;
  }

  return false;
}

export function matchesGenre(item: LibraryItem, genre: string): boolean {
  if (item.genres?.find(g => g === genre))
    return true;
  else if (!item.data)
    return false;

  for (const child of item.data) {
    if (matchesGenre(child, genre))
      return true;
  }

  return false;
}

export function searchForm(s: string): string {
  return stripDiacriticals_lc(s.trim()).replace(/[^_0-9a-z]/gi, '');
}

function findItemById(items: LibraryItem[], id: number): LibraryItem {
  for (const item of items) {
    if (item.isAlias && !item.parent)
      continue;
    else if (item.id === id)
      return item;

    const match = findItemById(item.data || [], id);

    if (match)
      return match;
  }

  return null;
}

export function matchesSearch(item: LibraryItem, searchText: string, simpleMatch = false): boolean {
  if (!searchText)
    return true;
  else if ((!item.name && !item.title) || isTvEpisode(item) || isFile(item))
    return false;

  let text = searchText;
  let itemText: string;
  const $ = /^(act|dir)\w*\s*:\s*(.+)$/i.exec(text);

  if ($) {
    text = $[2];

    if ($[1].toLowerCase() === 'act')
      itemText = nfe(item.actors) ? item.actors.map(a => a.name).join(';') : '~~~';
    else
      itemText = nfe(item.directors) ? item.directors.map(d => d.name).join(';') : '~~~';
  }
  else
    itemText = (item.name && item.title ? item.name + '_' + item.title : item.name || item.title || '');

  text = searchForm(text);

  if (searchForm(itemText).includes(text))
    return true;
  else if (simpleMatch || item.isAlias)
    return false;
  else { // Does the name of an ancestor collection match?
    let testItem = item.parent?.data && findItemById(item.parent.data, item.id)?.parent;

    while (testItem) {
      const itemText = (testItem.name && testItem.title ? testItem.name + ';' + testItem.title : testItem.name || testItem.title || '');

      if (isCollection(testItem) && searchForm(itemText).includes(text))
        return true;

      testItem = testItem.parent;
    }
  }

  for (const child of (item.data || [])) {
    if (matchesSearch(child, searchText))
      return true;
  }

  return false;
}

export function filter(items: LibraryItem[], searchText: string, filter: string, genre: string,
                       sort?: (a: LibraryItem, b: LibraryItem, admin?: boolean) => number, admin?: boolean): LibraryItem[] {
  if (!searchText && filter === 'All' && !genre && !sort)
    return items;

  let matchFunction: (item: LibraryItem) => boolean;
  let filterSeasons = false;

  switch (filter) {
    case 'All':
      matchFunction = (_item: LibraryItem): boolean => true;
      filterSeasons = true;
      break;
    case 'Movies':
      matchFunction = containsMovie;
      filterSeasons = true;
      break;
    case 'TV':
      matchFunction = containsTV;
      break;
    case '4K':
      matchFunction = (item: LibraryItem): boolean => item.is4k;
      break;
    case '3D':
      matchFunction = (item: LibraryItem): boolean => item.is3d;
      break;

    default:
      matchFunction = (item: LibraryItem): boolean => matchesGenre(item, genre);
  }

  const isAMatch = (item: LibraryItem): boolean => matchesSearch(item, searchText) && matchFunction(item);

  items = clone(items).filter(item => isAMatch(item));

  const deepFilter = (items: LibraryItem[], matcher = isAMatch): void => {
    for (let i = 0; i < items?.length; ++i) {
      let item = items[i];

      if (item.data && (isCollection(item) || (isTvShow(item) && filterSeasons))) {
        const saveMatcher = matcher;

        if (matchesSearch(item, searchText, true))
          matcher = matchFunction;
        else if (item.isAlias) {
          const orig = (item.parent ? (item.parent.data || []) : items).find(i => !i.isAlias && i.id === item.id);

          if (orig && matchesSearch(orig, searchText, true))
            matcher = matchFunction;
        }

        deepFilter(item.data, matcher);

        const innerCount = item.data.reduce((sum, child) => sum + (matcher(child) ? 1 : 0), 0);

        // If only one match within a collection, surface that one match and eliminate the collection
        if (innerCount === 1) {
          items[i] = item = item.data.find(c => matcher(c));

          if (isTvSeason(item) && !matchesSearch(item, searchText, true))
            item.name = item.parent.name + ' • ' + item.name;
        }
        // If multiple but partial matches within a collection, filter collection items that don't match.
        else if (innerCount < item.data.length)
          item.data = item.data.filter(c => matcher(c));

        matcher = saveMatcher;
      }
    }
  };

  deepFilter(items);
  items.sort((a, b) => {
    const diff = sort ? sort(a, b, admin) : 0;

    if (diff !== 0)
      return diff;

    return librarySorter(a, b);
  });

  const reassignParents = (items: LibraryItem[], newParent?: LibraryItem): void => {
    for (const item of items) {
      item.parent = newParent;
      reassignParents(item.data || [], item);
    }
  };

  reassignParents(items);

  // Purge duplicate results
  let lastID = -1;

  for (let i = items.length - 1; i >= 0; --i) {
    const item = items[i];

    if (item.id === lastID && lastID >= 0) {
      if (!matchesSearch(item, searchText, true))
        items.splice(i, 1);
      else {
        const other = items[i + 1];

        if (!other.isAlias && matchesSearch(other, searchText, true))
          items.splice(i, 1);
        else
          items.splice(i + 1, 1);
      }
    }

    lastID = item.id;
  }

  // Purge items included in a displayed collection
  const currentCollections = new Set(items.filter(i => isCollection(i)).map(i => i.id));

  for (let i = items.length - 1; i >= 0; --i) {
    let item = items[i];

    if (isCollection(item)) {
      if (item.isAlias)
        item = findItemById(items, item.id);

      if (item && item.parent && currentCollections.has(item.parent.id))
        items.splice(i, 1);
    }
  }

  return items;
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

export function compareCaseInsensitiveIntl(a: string, b: string): number {
  return comparator(a.toLocaleLowerCase('en'), b.toLocaleLowerCase('en'));
}

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
    .replace(/#/g, '_').replace(/[-_][234][DK](?=\))/, '').replace('()', '').trim();

  return parent + s;
}

export function ts(): string {
  return new Date().toISOString().slice(0, -5).replace('T', ' ');
}

export function hashUri(uri: string): string {
  return uri ? checksum53(uri.replace(/^\//, '').normalize()) : '';
}

export function findAliases(id: number, itemOrLib?: LibraryItem | VideoLibrary, matches: LibraryItem[] = [], inAlias = false): LibraryItem[] {
  const item: LibraryItem = (itemOrLib as any).array ? null : itemOrLib as LibraryItem;

  if (item?.id === id && (item?.isAlias || inAlias))
    matches.push(item);

  const data = item ? item.data : (itemOrLib as VideoLibrary)?.array;

  inAlias = inAlias || item?.collectionId === -2;

  if (data) {
    for (const child of data)
      findAliases(id, child, matches, inAlias);
  }

  return matches;
}

export function syncValues(src: LibraryItem, tar: LibraryItem): void {
  const fields = ['watched', 'lastWatchTime', 'position'];

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

export function stripBackLinks(children: LibraryItem[]): void {
  if (!children)
    return;

  for (const child of children || []) {
    delete child.parent;

    if (child.data)
      stripBackLinks(child.data);
  }
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
  addedTime: number;
  counts?: {
    duration: number;
    position: number;
    unwatched: number;
    watched: number;
  },
  duration: number;
  incomplete: boolean;
  mixed: boolean;
  position: number;
  stream?: string;
  watched: boolean;
}

interface WatchedInfo {
  duration: number;
  item: LibraryItem;
  lastWatchTime: number;
  path: string;
  position: number;
  watched: boolean;
}

function mostRecentAddedTime(item: LibraryItem): number {
  if (item.addedTimeCached != null)
    return item.addedTimeCached;

  let addedTime = item.addedTime ?? 0;

  for (const child of item.data || [])
    addedTime = Math.max(addedTime, mostRecentAddedTime(child));

  return (item.addedTimeCached = addedTime);
}

export function getWatchInfo(asAdmin: boolean, item: LibraryItem, wi?: WatchInfo, unique = true): WatchInfo {
  let atTop = false;

  if (!wi) {
    atTop = true;
    wi = {
      addedTime: mostRecentAddedTime(item),
      counts: { duration: 0, position: 0, unwatched: 0, watched: 0 },
      duration: 0,
      incomplete: false,
      mixed: false,
      position: 0,
      watched: false
    };
  }

  if (!asAdmin && item?.streamUri && !wi.stream)
    wi.stream = item.streamUri;

  const priorCounts = clone(wi.counts);
  let watched = false;
  let position = 0;

  if (item?.duration != null && ((asAdmin && isFile(item)) || item.streamUri)) {
    watched = asAdmin ? item.watched : item.watchedByUser;
    position = asAdmin ? item.position : item.positionUser;
    wi.counts.duration += unique ? item.duration : 0;
    wi.counts.position += unique ? (watched && position <= 0 ? item.duration : position) : 0;
    wi.counts.unwatched += watched ? 0 : 1;
    wi.counts.watched += watched && unique ? 1 : 0;
  }

  let videoCount = 1;

  if (item?.data) {
    const uniquePaths = new Set<string>();
    const uniqueVideos = new Map<string, WatchedInfo[]>();

    videoCount = item.data.length;
    item.data.forEach((i, n) => {
      if (!i.streamUri && !i.uri && i.data?.length === 1)
        i = i.data[0];

      const path = i.streamUri || i.uri?.replace('/2K/', '/') || '';
      const key = isMovie(i.parent) ? '#' + i.parent.id : path || n.toString();
      const list = getOrSet(uniqueVideos, key, []);

      uniquePaths.add(path);
      list.push({
        duration: i.duration,
        item: i,
        lastWatchTime: asAdmin ? i.lastWatchTime : i.lastUserWatchTime,
        path,
        position: asAdmin ? i.position : i.positionUser,
        watched: asAdmin ? i.watched : i.watchedByUser
      });
    });

    uniqueVideos.forEach(infos => {
      let unique: WatchedInfo;

      infos.sort((a, b) => b.lastWatchTime - a.lastWatchTime);
      unique = infos.find(i => i.position > 0);

      if (!unique) {
        infos.sort((a, b) => b.position - a.position);
        unique = infos.find(i => i.position > 0);
      }

      if (!unique) {
        infos.sort((a, b) => b.duration - a.duration);
        unique = infos.find(i => i.watched);
      }

      if (!unique)
        unique = infos[0];

      for (const info of infos)
        getWatchInfo(asAdmin, info.item, wi, !info.path || info === unique);
    });

    if (uniquePaths.size > 0 && uniquePaths.size < videoCount)
      videoCount = uniquePaths.size;
  }

  if (atTop) {
    wi.watched = (wi.counts.watched > 0);
    wi.incomplete = (wi.counts.watched > 0 &&
                     (isAnyCollection(item) || isTvShow(item) || wi.counts.watched < videoCount) &&
                     wi.counts.unwatched > 0);
    wi.mixed = wi.incomplete && !isMovie(item);
    wi.duration = wi.counts.duration;
    wi.position = wi.counts.position;
    delete wi.counts;
  }
  else if (wi.counts.watched > priorCounts.watched && isMovie(item)) {
    wi.counts.watched = priorCounts.watched + videoCount;
    wi.counts.unwatched = priorCounts.unwatched;
  }

  return wi;
}

export function setWatched(item: LibraryItem, state: boolean, admin = false, position?: number,
                    findId?: (id: number) => LibraryItem, now?: number): void {
  if (!item)
    return;

  if (position == null)
    position = state ? 0 : -1;

  if (now == null)
    now = Date.now();

  if (admin && !state && item.duration && position > item.duration - 120 && position > item.duration * 0.983)
    state = true;

  if (admin && (item.watched != null || isFile(item))) {
    item.watched = state;
    item.lastWatchTime = state || position < 15 ? now : -1;
    item.position = state ? 0 : position > 0 ? position : -1;
  }
  else if (!admin && item.streamUri) {
    item.watchedByUser = state;
    item.positionUser = state ? 0 : -1;
    item.lastUserWatchTime = state ? now : -1;
  }

  const parent = !admin && item.parent || (findId && findId(item.parentId));

  if (parent?.data) {
    parent.data.forEach(sibling => {
      if (sibling !== item && sibling.streamUri === item.streamUri) {
        sibling.watchedByUser = state;
        sibling.positionUser = state ? 0 : -1;
        sibling.lastUserWatchTime = state ? Date.now() : -1;
      }
    });
  }

  if (item.data)
    item.data.forEach(i => setWatched(i, state, admin, position, findId, now));
}

export async function sleep(millis: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(() => resolve(), millis);
  });
}
