import { LibraryItem } from '../../server/src/shared-types';
import { isString, stripDiacriticals_lc, toInt } from '@tubular/util';
import { isCollection, isMovie, isTvSeason, isTvShow } from '../../server/src/shared-utils';
import { fromEvent } from 'rxjs/internal/observable/fromEvent';
import { debounceTime } from 'rxjs/internal/operators/debounceTime';
import { compare as imageCompare } from 'resemblejs';
import { EventEmitter } from '@angular/core';
import { floor, round } from '@tubular/math';

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

export function broadcastMessage(type: string, data?: any): void {
  wsEmitter.emit({ type, data });
}

export function webSocketMessagesEmitter(): EventEmitter<WSMessage> {
  return wsEmitter;
}

export function formatSecondsToDays(secs: number): string {
  secs = round(secs);
  const days = floor(secs / 86400);
  secs -= days * 86400;
  const hours = floor(secs / 3600);
  secs -= hours * 3600;
  const minutes = floor(secs / 60);
  secs -= minutes * 60;

  return `${days}d${hours.toString().padStart(2, '0')}h${minutes.toString().padStart(2, '0')}m${secs.toString().padStart(2, '0')}s`;
}

export function getChannelCount(s: string): number {
  if (/mono/i.test(s))
    return 1;
  else if (/stereo/i.test(s))
    return 2;
  else if (/atmos/i.test(s))
    return 8; // Not guaranteed to be 8 (7 + 1), but a good enough value for the purpose of this function.

  const $ = /(\d+)(\.\d)?/.exec(s);

  if ($)
    return toInt($[1]) + toInt($[2].substring(1));
  else
    return 2;
}
