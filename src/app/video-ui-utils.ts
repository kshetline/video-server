import { LibraryItem } from '../../server/src/shared-types';
import { isString, stripDiacriticals_lc } from '@tubular/util';
import { isCollection, isMovie, isTvSeason, isTvShow } from '../../server/src/shared-utils';
import { fromEvent } from 'rxjs/internal/observable/fromEvent';
import { debounceTime } from 'rxjs/internal/operators/debounceTime';
import { compare as imageCompare } from 'resemblejs';
import { EventEmitter } from '@angular/core';

let imageIndex = 0;

export function setCssVariable(name: string, value: string): void {
  (document.querySelector(':root') as HTMLElement).style.setProperty(name, value);
}

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
  setCssVariable('--scrollbar-width', (w1 - w2) + 'px');
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
  return stripDiacriticals_lc(s.trim()).replace(/[^_0-9a-z]/gi, '');
}

async function getImageData(image: string | HTMLImageElement): Promise<ImageData> {
  return new Promise<ImageData>(resolve => {
    const drawImage = (img: HTMLImageElement): void => {
      const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as any;

      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight));
    };

    if (isString(image)) {
      const img = new Image();

      img.addEventListener('load', () => {
        setTimeout(() => img.remove());
        drawImage(img);
      });
      img.addEventListener('error', () => { img.remove(); resolve(null); });
      img.src = image;
    }
    else
      drawImage(image);
  });
}

export async function areImagesSimilar(image1: string | HTMLImageElement, image2: string | HTMLImageElement): Promise<boolean> {
  if (image1 === image2)
    return true;
  else if (!image1 !== !image2)
    return false;

  const data1 = await getImageData(image1);
  const data2 = await getImageData(image2);

  if (!data1 && !data2)
    return true;
  else if (!data1 !== !data2)
    return false;

  return new Promise<boolean>(resolve => {
    imageCompare(data1, data2, { ignore: 'antialiasing', scaleToSameSize: true }, (err, data) => {
      resolve(!err && data.rawMisMatchPercentage < 5);
    });
  });
}

export function formatSize(b: number): string {
  let unit = 'TB';

  for (const u of ['bytes', 'KB', 'MB', 'GB']) {
    if (b < 1000.5) {
      unit = u;
      break;
    }
    else
      b /= 1000;
  }

  return b.toPrecision(4) + '\u202F' + unit;
}

export interface WSMessage {
  type: string;
  data: any;
}

const wsEmitter = new EventEmitter<WSMessage>();

export function broadcastMessage(type: string, data: any): void {
  wsEmitter.emit({ type, data });
}

export function webSocketMessagesEmitter(): EventEmitter<WSMessage> {
  return wsEmitter;
}
