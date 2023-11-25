import { LibraryItem } from '../../server/src/shared-types';
import { stripDiacriticals_lc } from '@tubular/util';
import { isCollection, isMovie, isTvSeason, isTvShow } from '../../server/src/shared-utils';
import { fromEvent } from 'rxjs/internal/observable/fromEvent';
import { debounceTime } from 'rxjs/internal/operators/debounceTime';

let imageIndex = 0;

function getScrollBarWidth(): void {
  const inner = document.createElement('p');

  inner.style.width = '100%';
  inner.style.height = '200px';

  const outer = document.createElement('div');

  outer.style.position = 'absolute';
  outer.style.top = '0px';
  outer.style.left = '0px';
  outer.style.visibility = 'hidden';
  outer.style.width = '200px';
  outer.style.height = '150px';
  outer.style.overflow = 'hidden';
  outer.appendChild(inner);

  document.body.appendChild(outer);

  const w1 = inner.offsetWidth;

  outer.style.overflow = 'scroll';

  let w2 = inner.offsetWidth;

  if (w1 === w2)
    w2 = outer.clientWidth;

  document.body.removeChild(outer);
  (document.querySelector(':root') as HTMLElement).style.setProperty('--scrollbar-width', (w1 - w2) + 'px');
}

const resizes = fromEvent(window, 'resize');

resizes.pipe(debounceTime(500)).subscribe(() => getScrollBarWidth());
getScrollBarWidth();

export function getImageParam(): string {
  return imageIndex > 0 ? '&ii=' + imageIndex : '';
}

export function incrementImageIndex(): number {
  return ++imageIndex;
}

export function addBackLinks(children: LibraryItem[], parent?:LibraryItem): void {
  for (const child of children || []) {
    if (parent)
      child.parent = parent;

    if (child.data)
      addBackLinks(child.data, child);
  }
}

export function getTitle(item: LibraryItem, baseItem?: LibraryItem): string {
  if (!item)
    return '';
  else if (isMovie(item) || isTvShow(item))
    return item.name;
  else if (item.parent)
    return getTitle(item.parent, baseItem ?? item);
  else if (baseItem && !isCollection(baseItem))
    return baseItem.name;
  else
    return '';
}

export function getSeasonTitle(item: LibraryItem): string {
  const name = item.originalName ?? item.name;

  if (!item)
    return '';
  else if (isMovie(item))
    return name;
  else if (isTvSeason(item) && item.parent?.name &&
           stripDiacriticals_lc(name).includes(stripDiacriticals_lc(item.parent.name)))
    return name;

  let title = getTitle(item);
  const baseSeason = name.trim();
  let season = baseSeason;
  const innerTitle = item.data && item.data[0] && item.data[0].data && item.data[0].data[0] && item.data[0].data[0].title;
  const $ = /^([^•]+)/.exec(innerTitle);

  if (isTvSeason(item) && !/\bMiniseries|Season\b/i.test(season) && item.season)
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

export function searchForm(s: string): string {
  return stripDiacriticals_lc(s.trim()).replace(/[^_0-9a-z]/i, '');
}
