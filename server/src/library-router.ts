import { Router } from 'express';
import { LibraryItem, LibraryStatus, MediaInfo, MediaInfoTrack, PlaybackProgress, ShowInfo, Track, VideoLibrary, VType } from './shared-types';
import { clone, forEach, isNumber, toBoolean, toInt, toNumber } from '@tubular/util';
import { abs, floor, min } from '@tubular/math';
import { requestJson } from 'by-request';
import paths from 'path';
import { readdir, readFile, writeFile } from 'fs/promises';
import { cacheDir, existsAsync, isAdmin, isDemo, itemAccessAllowed, jsonOrJsonp, noCache, role, safeLstat, unref, username, webSocketSend } from './vs-util';
import { existsSync, lstatSync, readFileSync } from 'fs';
import {
  comparator, hashUrl, isAnyCollection, isCollection, isFile, isMovie, isTvCollection, isTvEpisode, isTvSeason, isTvShow, librarySorter, toStreamPath
} from './shared-utils';
import { sendStatus } from './app';
import { setStopPending, stopPending } from './admin-router';
import { getDb } from './settings';

export const router = Router();

const SEASON_EPISODE = /\bS(\d{1,2})E(\d{1,3})\b/i;
const SPECIAL_EPISODE = /-M(\d\d?)-/;
const DAY = 86_400_000;

const DIRECTORS = /\(.*\bDirector['’]s\b/i;
const FINAL = /\(.*\bFinal\b/i;
const EXTENDED = /(\/|\(.*)\bExtended\b/i;
const INT_THEATRICAL = /\(.*\bInternational Theatrical\b/i;
const SPECIAL_EDITION = /\bspecial edition\b/i;
const UNRATED = /\bunrated\b/i;
const THEATRICAL = /(\/|\(.*)\b(Original|Theatrical)\b/i;

const libraryFile = paths.join(cacheDir, 'library.json');
const vSource = process.env.VS_VIDEO_SOURCE;
const sSource = process.env.VS_STREAMING_SOURCE;

export let cachedLibrary = { status: LibraryStatus.NOT_STARTED, progress: -1 } as VideoLibrary;
export let pendingLibrary: VideoLibrary;
export let mappedDurations = new Map<string, number>();

let pendingUpdate: any;
let nextId: number;

interface Alias {
  aspectRatioOverride?: string;
  collection?: string;
  hideOriginal?: boolean;
  isTV?: boolean;
  isTvMovie?: boolean;
  name?: string;
  newType?: number;
  path?: string;
  poster?: string;
  season?: string;
}

interface Collection {
  altNames?: string[],
  isTV?: boolean;
  name: string;
  poster?: string;
  aliases: Alias[]
}

interface Mappings {
  aliases?: Alias[],
  changes?: Alias[],
  collections?: Collection[]
}

function formatAspectRatioNumber(ratio: number): string {
  if (abs(ratio - 1.33) < 0.02)
    return '4:3';
  else if (abs(ratio - 1.78) < 0.03)
    return '16:9';
  else if (abs(ratio - 1.85) < 0.03)
    return 'Wide';
  else if (isNumber(ratio))
    return ratio.toFixed(2) + ':1';
  else
    return '';
}

function formatAspectRatio(track: MediaInfoTrack): string {
  if (!track)
    return '';

  let ratio: number;

  if (track.DisplayAspectRatio)
    ratio = toNumber(track.DisplayAspectRatio);
  else {
    const w = toInt(track.Width);
    const h = toInt(track.Height);

    ratio = w / h;
  }

  return formatAspectRatioNumber(ratio);
}

function formatResolution(track: MediaInfoTrack): string {
  if (!track)
    return '';

  const w = toInt(track.Width);
  const h = toInt(track.Height);

  if (w >= 2000 || h >= 1100)
    return 'UHD';
  else if (w >= 1300 || h >= 700)
    return 'FHD';
  else if (w >= 750 || h >= 500)
    return 'HD';
  else
    return 'SD';
}

function channelString(track: MediaInfoTrack): string {
  const $ = /\b(mono|stereo|(\d\d?\.\d))\b/i.exec(track.Title || '');

  if ($)
    return $[1];

  // The code below is a bit iffy. It's working for me for now, but there's some stuff I don't
  // fully understand about channel info, particularly how the `XXX_Original` variants are
  // supposed to work. No answers from the mediainfo forum yet!
  const channels = toInt(track.Channels);
  const sub = (channels > 4) || /\bLFE\b/.test(track.ChannelLayout);

  if (channels === 1 && !sub)
    return 'Mono';
  else if (channels === 2 && !sub)
    return 'Stereo';
  else if (!sub)
    return channels + '.0';
  else
    return (channels - 1) + '.1';
}

function getCodec(track: MediaInfoTrack): string {
  if (!track)
    return '';

  let codec = track.Format || '';

  if (track.CodecID === 'A_TRUEHD')
    codec = 'TrueHD';
  else if (codec === 'E-AC-3')
    codec = 'E-AC3';
  else if (codec === 'AVC')
    codec = 'H.264';
  else if (codec === 'HEVC')
    codec = 'H.265';

  if (track['@type'] === 'Video') {
    if (toInt(track.BitDepth) > 8)
      codec += ' ' + track.BitDepth + '-bit';

    if (track.HDR_Format_Compatibility)
      codec += ' HDR';
  }

  return codec;
}

const FIELDS_TO_KEEP = new Set(['id', 'parentId', 'collectionId', 'aggregationId', 'type', 'voteAverage', 'name', 'is3d',
  'is4k', 'isHdr', 'isFHD', 'is2k', 'isHD', 'year', 'duration', 'watched', 'data', 'duration', 'uri', 'season', 'episode']);

function filter(item: LibraryItem): void {
  if (item) {
    const keys = Object.keys(item);

    for (const key of keys) {
      if (!FIELDS_TO_KEEP.has(key))
        delete (item as any)[key];
    }
  }
}

async function getChildren(items: LibraryItem[], bonusDirs: Set<string>, directoryMap: Map<string, string[]>): Promise<void> {
  for (const item of (items || [])) {
    if (stopPending)
      break;

    if (item.videoinfo) {
      item.duration = item.videoinfo.duration;
      item.uri = item.videoinfo.uri;
      item.watched = (item.videoinfo.lastWatchTime >= 0 && item.videoinfo.playPoint / item.videoinfo.duration > 0.5);
      delete item.videoinfo;
    }

    filter(item);

    if (item.type > VType.FILE) {
      const url = process.env.VS_ZIDOO_CONNECT + `ZidooPoster/getCollection?id=${item.id}`;
      const data = (await requestJson(url) as LibraryItem).data;

      if (data) {
        item.data = data;
        await getChildren(item.data, bonusDirs, directoryMap);
      }
    }
    else if (!/-Extras-|Bonus Disc/i.exec(item.uri || '')) {
      if (item.uri) {
        let streamUriBase = toStreamPath(item.uri);

        outer:
        for (const ext of ['.mpd', '.av.webm']) {
          const streamUri = streamUriBase + ext;

          if (await existsAsync(paths.join(sSource, streamUri))) {
            item.streamUri = streamUri;
            break;
          }

          let altUri = streamUri.replace(/([/\\])([^/\\]+$)/, '$1\x32K$1$2');

          if (await existsAsync(paths.join(sSource, altUri))) {
            item.streamUri = altUri;
            break;
          }

          const $ = /^(.+)\(\d*_([^)]*)\b(4K|3D)\)(.*)/.exec(streamUri);

          if ($) {
            for (const alt of ['2K', '2D']) {
              for (let i = 0; i < 10; ++i) {
                altUri = `${$[1]}(${i === 0 ? '' : i}_${$[2]}${alt})${$[4]}`;

                if (await existsAsync(paths.join(process.env.VS_STREAMING_SOURCE, altUri))) {
                  item.streamUri = altUri;
                  break outer;
                }
              }
            }
          }
        }

        streamUriBase = (item.streamUri ? item.streamUri.replace(/(\.mpd|\.av\.webm)$/, '') : streamUriBase);

        const mobileUri = streamUriBase + '.mobile.mp4';

        if (await existsAsync(paths.join(sSource, mobileUri)))
          item.mobileUri = mobileUri;

        const sampleUri = streamUriBase + '.sample.mp4';

        if (await existsAsync(paths.join(sSource, sampleUri)))
          item.sampleUri = sampleUri;
      }

      const file = (/^.*?([^\\/]*)$/.exec(item.uri) || [])[1] || item.uri;
      const $ = /\((\d*)#([-_.a-z0-9]+)\)/i.exec(file);

      if ($) {
        item.cut = $[2];
        item.cutSort = toInt($[1]);
      }
      else if (DIRECTORS.test(file)) {
        item.cut = 'DC';
        item.cutSort = 3;
      }
      else if (FINAL.test(file)) {
        item.cut = 'FC';
        item.cutSort = 2;
      }
      else if (EXTENDED.test(file)) {
        item.cut = 'EC';
        item.cutSort = 4;
      }
      else if (INT_THEATRICAL.test(file)) {
        item.cut = 'ITC';
        item.cutSort = 6;
      }
      else if (SPECIAL_EDITION.test(file)) {
        item.cut = 'SE';
        item.cutSort = 1;
      }
      else if (UNRATED.test(file)) {
        item.cut = 'UR';
        item.cutSort = 5;
      }
      else if (THEATRICAL.test(file)) {
        item.cut = 'TC';
        item.cutSort = 7;
      }
      else {
        item.cut = '';
        item.cutSort = 999;
      }
    }

    if (isTvEpisode(item) && item.data?.length > 0) {
      const video = item.data[0];
      let $ = SEASON_EPISODE.exec(video.title) || SEASON_EPISODE.exec(video.name) || SEASON_EPISODE.exec(video.uri);

      if ($) {
        item.season = toInt($[1]);
        item.episode = toInt($[2]);
      }
      else if (($ = SPECIAL_EPISODE.exec(video.name)) || ($ = SPECIAL_EPISODE.exec(video.title))) {
        item.season = 0;
        item.episode = toInt($[1]);
      }
    }

    if (item.data?.length > 0 && isTvSeason(item))
      item.data.sort((a, b) => (a.episode || 0) - (b.episode || 0));

    let uri: string;

    if (item.data?.length > 0) {
      const checkedUris = new Set<string>();
      const extras = new Set<string>();

      for (let i = 0; i < item.data.length; ++i) {
        if (isTvShow(item))
          uri = paths.dirname(item.data[i]?.data[0]?.data[0]?.uri);
        else if (isTvSeason(item))
          uri = item.data[i]?.data[0]?.uri;
        else
          uri = item.data[i].uri;

        if (uri && !checkedUris.has(uri)) {
          checkedUris.add(uri);

          if (isMovie(item) || isTvShow(item) || isTvSeason(item)) {
            const basePath = paths.dirname(paths.join(vSource, uri));

            for (const bonusDir of Array.from(bonusDirs)) {
              const checkPath = paths.join(basePath, bonusDir);

              if (directoryMap.has(checkPath))
                directoryMap.get(checkPath).map(
                  file => paths.join(checkPath, file).substring(vSource.length).replace(/\\/g, '/'))
                  .forEach(x => extras.add(x));
            }
          }
        }
      }

      if (extras.size > 0)
        item.extras = Array.from(extras);
    }

    if (items === pendingLibrary.array) {
      pendingLibrary.progress = min(pendingLibrary.progress + 44 / 2.89 / pendingLibrary.total, 39.7);
      sendStatus();
    }
  }
}

async function getMediaInfo(items: LibraryItem[]): Promise<void> {
  const db = getDb();

  for (const item of (items || [])) {
    if (stopPending)
      break;

    if (isFile(item)) {
      const url = process.env.VS_ZIDOO_CONNECT + `Poster/v2/getVideoInfo?id=${item.aggregationId}`;
      const data: { mediaJson: string } = await requestJson(url);
      const mediaInfo: MediaInfo = JSON.parse(data.mediaJson || 'null');

      if (mediaInfo?.media?.track) {
        for (const track of mediaInfo.media.track) {
          const t = {} as Track;

          if (track.Title)
            t.name = track.Title;

          if (track.Language && track.Language !== 'und')
            t.language = track.Language;

          if (track.Format)
            t.codec = getCodec(track);

          switch (track['@type']) {
            case 'General':
              item.title = track.Title || track.Movie;
              break;
            case 'Video':
              if (item.aspectRatioOverride)
                item.aspectRatio = item.aspectRatioOverride;
              else {
                const key = item.uri.replace(/^[\\/]/, '').normalize();
                const row = await db.get<any>('SELECT * FROM aspects WHERE key = ?', key);

                if (row?.aspect)
                  item.aspectRatio = formatAspectRatioNumber(row.aspect);
                else
                  item.aspectRatio = formatAspectRatio(track);

                item.resolution = formatResolution(track);
              }

              item.video = item.video ?? [];
              item.video.push(t);

              break;
            case 'Audio':
              t.channels = channelString(track);
              item.audio = item.audio ?? [];
              item.audio.push(t);
              break;
            case 'Text':
              item.subtitle = item.subtitle ?? [];
              item.subtitle.push(t);
              break;
          }
        }
      }
    }
    else
      await getMediaInfo(item.data);

    if (items === pendingLibrary.array) {
      pendingLibrary.progress = min(pendingLibrary.progress + 110 / 2.89 / pendingLibrary.total, 77.8);
      sendStatus();
    }
  }
}

async function getDirectories(dir: string, bonusDirs: Set<string>, map: Map<string, string[]>): Promise<number> {
  const files = (await readdir(dir)).sort(comparator);
  let count = 0;

  for (const file of files) {
    if (stopPending)
      break;

    const path = paths.join(dir, file);
    const stat = await safeLstat(path);

    if (file === '.' || file === '..' || stat.isSymbolicLink() || file.endsWith('~')) {}
    else if (stat.isDirectory()) {
      if (/\bBonus Disc\b/i.test(file))
        bonusDirs.add(file);

      const subCount = await getDirectories(path, bonusDirs, map);
      const isBonusDir = bonusDirs.has(file);

      if (isBonusDir)
        pendingLibrary.bonusFileCount += subCount;
      else {
        pendingLibrary.mainFileCount += subCount;
      }

      const specialDir = /[•§]/.test(path) || /§.*\bSeason 0?1\b/.test(path);

      if (!isBonusDir && (specialDir && subCount === 0 || !specialDir && subCount > 0)) {
        pendingLibrary.progress = min(pendingLibrary.progress + 71 / 2.89 / pendingLibrary.total, 24.5);
        sendStatus();
      }
    }
    else {
      if (!map.has(dir))
        map.set(dir, []);

      if (/\.(mkv|iso)$/i.test(file)) {
        map.get(dir).push(file);
        ++count;
      }
    }
  }

  return count;
}

const MOVIE_DETAILS = new Set(['backdropPath', 'certification', 'homepage', 'logo', 'overview', 'posterPath',
  'ratingTomatoes', 'releaseDate', 'tagLine']);
const SEASON_DETAILS = new Set(['episodeCount', 'overview', 'posterPath', 'seasonNumber']);
const EPISODE_DETAILS = new Set(['airDate', 'episodeCount', 'overview', 'posterPath', 'seasonNumber', 'watched']);

async function getShowInfo(items: LibraryItem[]): Promise<void> {
  for (const item of items || []) {
    if (isNumber((item as any).seasonNumber)) {
      item.season = (item as any).seasonNumber;
      delete (item as any).seasonNumber;
    }

    if (isMovie(item) || isTvShow(item) || isTvSeason(item) || isTvCollection(item)) {
      const url = process.env.VS_ZIDOO_CONNECT + `Poster/v2/getDetail?id=${item.id}`;
      const showInfo: ShowInfo = await requestJson(url);
      const topInfo = showInfo.aggregation?.aggregation;

      if (showInfo.tv) {
        if (showInfo.tv.backdropPath)
          item.backdropPath = showInfo.tv.backdropPath;

        if (showInfo.tv.certification)
          item.certification = showInfo.tv.certification;

        if (showInfo.tv.homepage)
          item.homepage = showInfo.tv.homepage;

        if (showInfo.tv.numberOfSeasons)
          item.seasonCount = showInfo.tv.numberOfSeasons;

        if (showInfo.tv.type)
          item.tvType = showInfo.tv.type;
      }

      if (isMovie(item)) {
        if (topInfo) {
          forEach(topInfo, (key, value) => {
            if (MOVIE_DETAILS.has(key) && value)
              (item as any)[key] = value;
          });
        }
      }
      else {
        if (topInfo) {
          forEach(topInfo, (key, value) => {
            if (key === 'seasonNumber' && isNumber(value))
              item.season = value;
            else if (SEASON_DETAILS.has(key) && value)
              (item as any)[key] = value;
          });
        }

        const episodeInfo = showInfo.aggregation?.aggregations;

        if (episodeInfo?.length > 0 && item.data?.length > 0) {
          for (const info of episodeInfo) {
            const inner = info.aggregation;
            const match = inner?.episodeNumber != null && item.data.find(d => d.episode === inner.episodeNumber);

            if (match) {
              forEach(inner, (key, value) => {
                if (EPISODE_DETAILS.has(key) && value != null && value !== '')
                  (match as any)[key] = value;
              });
            }
          }
        }
      }

      if (showInfo.directors)
        item.directors = showInfo.directors.map(d => ({ name: d.name, profilePath: d.profilePath }));

      if (showInfo.actors)
        item.actors = showInfo.actors.map(a => ({ character: a.character, name: a.name, profilePath: a.profilePath }));

      if (showInfo.genres)
        item.genres = showInfo.genres.map(g => g.name);

      if (isTvCollection(item) || isTvShow(item))
        await getShowInfo(item.data);
    }
    else
      await getShowInfo(item.data);

    if (items === pendingLibrary.array) {
      pendingLibrary.progress = min(pendingLibrary.progress + 64 / 2.89 / pendingLibrary.total, 99.4);
      sendStatus();
    }
  }
}

function fixVideoFlagsAndEncoding(items: LibraryItem[]): void {
  for (const item of items) {
    if (item.uri)
      item.uri = item.uri.normalize();

    if (item.logo)
      item.logo = item.logo.normalize();

    if (item.data?.length > 0)
      fixVideoFlagsAndEncoding(item.data);

    // Identify year of collection or TV show by the earliest item/season.
    if ((isTvShow(item) || isCollection(item)) && item.data?.length > 0) // TODO: Add year range?
      item.year = min(item.year, ...item.data.filter(i => i.year).map(i => i.year));
  }

  for (const item of items) {
    delete item.is2k;

    if (isFile(item)) {
      if (!item.is3d || item.uri.endsWith('(2D).mkv'))
        delete item.is3d;

      if (item.uri.endsWith('(2K).mkv') || item.uri.includes('/2K/'))
        item.resolution = 'FHD';

      delete item.isHD;
      delete item.isFHD;
      delete item.is4k;
      delete item.isHdr;

      switch (item.resolution) {
        case 'HD': item.isHD = true; break;
        case 'FHD': item.isFHD = true; break;
        case 'UHD': item.is4k = true; break;
        default: item.isSD = true; break;
      }

      if (/\bHDR/.test((item.video || [])[0]?.codec || ''))
        item.isHdr = true;
    }
    else {
      const data: any[] = item.data || [];

      for (const flag of ['is3d', 'isHD', 'isFHD', 'is4k', 'isHdr']) {
        if (data.find(v => v[flag]))
          (item as any)[flag] = true;
        else
          delete (item as any)[flag];
      }
    }
  }
}

function findMatchingUri(items: LibraryItem[], uri: string, parent?: LibraryItem): LibraryItem {
  for (const item of items) {
    if (item.isAlias)
      continue;
    else if (parent && item.uri && paths.dirname(item.uri) === uri)
      return parent;
    else if (item.data?.length > 0) {
      let match = findMatchingUri(item.data, uri, item);

      if (match) {
        if (isTvEpisode(match) && isTvSeason(parent))
          return parent;
        else {
          if (isTvSeason(match) && (match.name === 'Miniseries' || /^Season \d/.test(match.name))) {
            match = clone(match);
            match.name = parent.name;
          }

          return match;
        }
      }
    }
  }

  return null;
}

function matchAliases(aliases: Alias[], changeInfo = false): LibraryItem[] {
  const aliasedItems: LibraryItem[] = [];

  for (const alias of aliases || []) {
    let item: LibraryItem;

    if (alias.path)
      item = findMatchingUri(pendingLibrary.array, alias.path);
    else if (alias.collection)
      item = pendingLibrary.array.find(i => (isAnyCollection(i) || isTvShow(i)) && i.name === alias.collection);
    else if (alias.season) {
      const parts = alias.season.split('\t');

      if (parts.length < 2)
        item = pendingLibrary.array.find(i => isTvSeason(i) && i.name === alias.season);
      else {
        const show = pendingLibrary.array.find(i => isTvShow(i) && i.name === parts[0]);

        if (show && show.data)
          item = show.data.find(i => i.name === parts[1]);
      }
    }

    if (item) {
      if (changeInfo) {
        if (alias.newType != null)
          item.type = alias.newType;
        else if (alias.isTvMovie)
          item.isTvMovie = true;

        if (alias.aspectRatioOverride)
          item.aspectRatioOverride = alias.aspectRatioOverride;
      }
      else {
        if (alias.name !== '*HIDE*') {
          const copy = clone(item);

          copy.isAlias = true;
          copy.originalName = copy.name;
          copy.name = alias.name || copy.name;
          copy.isLink = true;

          if (alias.isTV || isTvSeason(item) || isTvShow(item))
            copy.isTV = true;

          if (alias.newType)
            copy.type = alias.newType;

          if (alias.poster)
            copy.aliasPosterPath = alias.poster;

          aliasedItems.push(copy);
        }

        if (alias.hideOriginal)
          item.hide = true;
      }
    }
    else
      console.error('Not found:', alias.name, alias.path || alias.collection);
  }

  return aliasedItems;
}

async function addMappings(): Promise<void> {
  const mappings = JSON.parse(await readFile(paths.join(vSource, 'mappings.json'), 'utf8')) as Mappings;
  const aliasedItems = matchAliases(mappings.aliases);

  matchAliases(mappings.changes, true);
  nextId = 0.5;

  for (const collection of mappings.collections || []) {
    const collectionItem: LibraryItem = {
      type: VType.COLLECTION,
      name: collection.name,
      isTV: !!collection.isTV,
      id: ++nextId, parentId: -1, collectionId: -1, aggregationId: -1,
      data: matchAliases(collection.aliases).map(a => { a.parentId = nextId; return a; })
    };

    if (collectionItem.data.length > 0) {
      if (collection.poster)
        collectionItem.aliasPosterPath = collection.poster;

      aliasedItems.push(collectionItem);

      if (collection.altNames) {
        for (const name of collection.altNames) {
          const altCopy = clone(collectionItem);

          altCopy.name = name;
          altCopy.isAlias = true;
          aliasedItems.push(altCopy);
        }
      }
    }
  }

  pendingLibrary.array.push(...aliasedItems);
}

function findVideoAux(asFile: boolean, id: number, item: LibraryItem): LibraryItem {
  if ((!asFile || isFile(item)) && item.id === id)
    return item;
  else if (item.data) {
    for (const child of item.data) {
      const match = findVideoAux(asFile, id, child);

      if (match)
        return match;
    }
  }

  return null;
}

export function findVideo(id: number): LibraryItem {
  return findVideoAux(true, id, { id: -1, data: cachedLibrary.array } as LibraryItem);
}

export function findId(id: number): LibraryItem {
  return findVideoAux(false, id, { id: -1, data: cachedLibrary.array } as LibraryItem);
}

export async function updateLibrary(quick = false): Promise<void> {
  if (pendingUpdate) {
    clearTimeout(pendingUpdate);
    pendingUpdate = undefined;
  }

  if (pendingLibrary)
    return;

  try {
    const url = process.env.VS_ZIDOO_CONNECT + 'Poster/v2/getFilterAggregations?type=0&start=0';
    const bonusDirs = new Set(['-Extras-']);

    pendingLibrary = await requestJson(url) as VideoLibrary;
    pendingLibrary.status = LibraryStatus.INITIALIZED;
    pendingLibrary.progress = 0;
    pendingLibrary.mainFileCount = 0;
    pendingLibrary.bonusFileCount = 0;
    sendStatus();

    if (cachedLibrary.status === LibraryStatus.NOT_STARTED) {
      cachedLibrary = pendingLibrary;
      mapDurations();
    }

    const directoryMap = new Map<string, string[]>();

    if (quick) {
      pendingLibrary = clone(cachedLibrary);
      pendingLibrary.array = pendingLibrary.array.filter(i => !i.isAlias && i.id === floor(i.id));
      pendingLibrary.array.forEach(i => delete i.hide);
    }
    else {
      await getDirectories(vSource, bonusDirs, directoryMap);
      pendingLibrary.progress = 24.5;
      sendStatus();
      pendingLibrary.status = LibraryStatus.BONUS_MATERIAL_LINKED;
      await getChildren(pendingLibrary.array, bonusDirs, directoryMap);
      pendingLibrary.progress = 39.7;
      sendStatus();
      pendingLibrary.status = LibraryStatus.ALL_VIDEOS;
      await getMediaInfo(pendingLibrary.array);
      fixVideoFlagsAndEncoding(pendingLibrary.array);
      pendingLibrary.progress = 77.8;
      sendStatus();
      pendingLibrary.status = LibraryStatus.MEDIA_DETAILS;
      await getShowInfo(pendingLibrary.array);
    }

    await addMappings();
    pendingLibrary.array.sort(librarySorter);
    pendingLibrary.status = LibraryStatus.DONE;
    pendingLibrary.lastUpdate = new Date().toISOString();
    pendingLibrary.progress = 100;
    cachedLibrary = pendingLibrary;
    mapDurations();
    sendStatus();

    await writeFile(libraryFile, JSON.stringify(cachedLibrary), 'utf8');
  }
  catch (e) {
    console.log('Mappings update failed:', e);
  }

  pendingLibrary = undefined;
  setStopPending(false);
  sendStatus();
}

function mapDurationsAux(items: LibraryItem[]): void {
  for (const item of items) {
    if (item.uri && item.duration)
      mappedDurations.set(item.uri.normalize(), item.duration);

    if (item.data)
      mapDurationsAux(item.data);
  }
}

function mapDurations(): void {
  mappedDurations = new Map<string, number>();

  mapDurationsAux(cachedLibrary?.array || []);
}

export function initLibrary(): void {
  const stats = existsSync(libraryFile) && lstatSync(libraryFile);

  if (stats) {
    cachedLibrary = JSON.parse(readFileSync(libraryFile).toString('utf8'));
    mapDurations();
  }

  const age = +Date.now() - +stats.mtime;

  if (!stats || age > DAY)
    updateLibrary().finally();
  else
    unref(pendingUpdate = setTimeout(() => {
      pendingUpdate = undefined;
      updateLibrary().finally();
    }, DAY - age));
}

function filterLibrary(items: LibraryItem[], role: string): void {
  for (let i = items.length - 1; i >= 0; --i) {
    const item = items[i];

    if (!itemAccessAllowed(item, role))
      items.splice(i, 1);
  }

  for (const item of items) {
    if (isDemo(role) && item.uri) {
      item.shadowUri = item.uri;
      item.uri = item.mobileUri = item.streamUri = item.sampleUri;
    }

    if (item.data)
      filterLibrary(item.data, role);
  }
}

async function updateWatchInfo(items: LibraryItem[], user: string): Promise<void> {
  for (const item of items) {
    if (item.streamUri) {
      try {
        const db = getDb();
        const row = await db.get('SELECT * FROM watched WHERE user = ? AND video = ?', user, hashUrl(item.streamUri)) as PlaybackProgress;

        if (row) {
          item.lastPlayTime = row.offset;
          item.watchedByUser = row.watched;
        }
      }
      catch {}
    }

    if (item.data)
      await updateWatchInfo(item.data, user);
  }
}

const sparseKeys = new Set([
  'aliasPosterPath', 'data', 'id', 'isAlias', 'isLink', 'name', 'originalName', 'releaseDate',
  'title', 'type', 'voteAverage', 'watched', 'year'
]);

function makeSparse(items: LibraryItem[], depth = 0): void {
  for (const item of items) {
    if (depth > 1)
      delete item.data;

    const keys = Object.keys(item);

    for (const key of keys) {
      if (!sparseKeys.has(key))
        delete (item as any)[key];
    }

    if (item.data)
      makeSparse(item.data, depth + 1);
  }
}

function setWatched(item: LibraryItem, state: boolean): void {
  if (!item)
    return;

  if (item.watched != null) {
    item.watched = state;

    if (state)
      item.position = -1;
  }

  if (item.data)
    item.data.forEach(i => setWatched(i, state));
}

router.put('/set-watched', async (req, res) => {
  const id = toInt(req.query.id);
  const watched = toInt(req.query.watched);

  try {
    const url = process.env.VS_ZIDOO_CONNECT + `Poster/v2/markAsWatched?aggregationId=${id}&watched=${watched}`;
    const response = await requestJson(url);

    if (response.status === 200 && response.msg === 'success') {
      let item = findId(id);

      if (item) {
        while (item.parentId > 0) {
          const parent = findId(item.parentId);

          if (parent)
            item = parent;
          else
            break;
        }

        setWatched(item, !!watched);
        webSocketSend({ type: 'idUpdate', data: item.id });
      }

      jsonOrJsonp(req, res, response);
    }
    else {
      res.status(response.status === 200 ? 400 : response.status);
      res.send(response.msg);
    }
  }
  catch {
    res.sendStatus(500);
  }
});

router.get('/', async (req, res) => {
  noCache(res);

  let response: LibraryItem | VideoLibrary = clone(cachedLibrary);

  response.array = response.array.filter(i => !i.hide);

  if (!isAdmin(req))
    filterLibrary(response.array, role(req));

  if (toBoolean(req.query.sparse)) {
    response.sparse = true;
    makeSparse(response.array);
  }
  else if (req.query.id)
    response = response.array.find(i => i.id === toNumber(req.query.id)) || null;

  if (response)
    await updateWatchInfo((response as VideoLibrary).array ?
      (response as VideoLibrary).array : [response as LibraryItem], username(req));

  jsonOrJsonp(req, res, response);
});
