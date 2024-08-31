import { Router } from 'express';
import {
  LibraryItem, LibraryStatus, MediaInfo, MediaInfoTrack, PlaybackProgress, PlayStatus, ShowInfo, Track,
  VideoLibrary, VType
} from './shared-types';
import {
  clone, compareCaseSecondary, forEach, isNumber, isObject, processMillis, toBoolean, toInt, toNumber
} from '@tubular/util';
import { abs, floor, max, min } from '@tubular/math';
import { requestJson } from 'by-request';
import paths from 'path';
import { readdir, readFile, writeFile } from 'fs/promises';
import {
  cacheDir, existsAsync, isAdmin, isDemo, itemAccessAllowed, jsonOrJsonp, noCache, role, safeLstat,
  unref, username, webSocketSend
} from './vs-util';
import { existsSync, lstatSync, readFileSync } from 'fs';
import {
  addBackLinks, comparator, findAliases as _findAliases, hashUri, isAnyCollection, isCollection, isFile, isMovie,
  isTvCollection, isTvEpisode, isTvSeason, isTvShow, librarySorter, removeBackLinks, setWatched, stripBackLinks, syncValues,
  toStreamPath
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

let lastFullWatchStateCheck = -1;
let watchCheckRunning = false;
const FULL_WATCH_CHECK_INTERVAL = 3600000;

export let cachedLibrary = { status: LibraryStatus.NOT_STARTED, progress: -1 } as VideoLibrary;
export let pendingLibrary: VideoLibrary;
export let mappedDurations = new Map<string, number>();
export let playerAvailable = true;
export let currentVideo: string;
export let currentVideoId = -1;
export let currentVideoPath: string;
export let currentVideoPosition = -1;

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

const FIELDS_TO_KEEP = new Set(['id', 'parentId', 'collectionId', 'aggregationId', 'type', 'voteAverage', 'name',
  'is3d', 'is4k', 'isHdr', 'isFHD', 'is2k', 'isHD', 'year', 'duration', 'watched', 'data', 'uri', 'season',
  'episode', 'position']);

function filter(item: LibraryItem): void {
  if (item) {
    const keys = Object.keys(item);

    for (const key of keys) {
      if (!FIELDS_TO_KEEP.has(key))
        delete (item as any)[key];
    }

    if (!isFile(item))
      delete item.watched;
  }
}

async function getChildren(items: LibraryItem[], bonusDirs: Set<string>, directoryMap: Map<string, string[]>): Promise<void> {
  for (const item of (items || [])) {
    if (stopPending)
      break;

    if (item.videoinfo) {
      item.duration = item.videoinfo.duration / 1000; // Make duration (originally in msecs) compatible with playback position (in seconds).
      item.position = item.videoinfo.playPoint ? max(item.videoinfo.playPoint / 1000, -1) : 0;
      item.uri = item.videoinfo.uri;
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
      const data: { mediaJson: string, lastWatchTime: number, playPoint: number } = await requestJson(url);
      const mediaInfo: MediaInfo = JSON.parse(data.mediaJson || 'null');

      item.lastWatchTime = data.lastWatchTime;
      item.position = max(data.playPoint / 1000, -1);

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

              if (/commentary/i.test(track.Title))
                item.commentaryAudio = true;
              break;
            case 'Text':
              item.subtitle = item.subtitle ?? [];
              item.subtitle.push(t);

              if (/commentary/i.test(track.Title))
                item.commentaryText = true;

              if (track.Default === 'Yes' || track.Forced === 'Yes')
                item.defaultSubtitles = true;
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

const MOVIE_DETAILS = new Set(['addedTime', 'backdropPath', 'certification', 'homepage', 'logo', 'lastWatchTime',
  'overview', 'posterPath', 'ratingTomatoes', 'releaseDate', 'tagLine', 'watched']);
const SEASON_DETAILS = new Set(['episodeCount', 'overview', 'posterPath', 'seasonNumber']);
const EPISODE_DETAILS = new Set(['addedTime', 'airDate', 'episodeCount', 'lastWatchTime', 'overview', 'position',
  'posterPath', 'seasonNumber', 'watched']);
const FILE_DETAILS = new Set(['addedTime', 'lastWatchTime', 'overview', 'position',
  'posterPath', 'seasonNumber', 'watched']);

async function getShowInfo(items: LibraryItem[], showInfos?: ShowInfo): Promise<void> {
  for (const item of items || []) {
    if (stopPending)
      break;

    if (isNumber((item as any).seasonNumber)) {
      item.season = (item as any).seasonNumber;
      delete (item as any).seasonNumber;
    }

    if (isMovie(item) || isTvShow(item) || isTvSeason(item) || isTvCollection(item) || isTvEpisode(item) || isFile(item)) {
      let showInfo: ShowInfo;

      if (!showInfos) {
        const url = process.env.VS_ZIDOO_CONNECT + `Poster/v2/getDetail?id=${item.id}`;

        showInfo = await requestJson(url);
      }
      else {
        showInfo = showInfos;
      }

      const videoInfo = showInfo.aggregation?.aggregations;
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

      let tv = false;
      let file = false;
      let season = false;

      if (topInfo) {
        if (isMovie(item)) {
          forEach(topInfo, (key, value) => {
            if (MOVIE_DETAILS.has(key) && value)
              (item as any)[key] = value;
          });
        }
        else if (isTvShow(item)) {
          tv = true;

          forEach(topInfo, (key, value) => {
            if (key === 'seasonNumber' && isNumber(value))
              item.season = value;
            else if (SEASON_DETAILS.has(key) && value)
              (item as any)[key] = value;
          });
        }
        else if (isFile(item)) {
          file = true;

          if (topInfo.watched != null)
            item.watched = topInfo.watched;
        }
        else if (isTvSeason(item))
          season = true;

        if (videoInfo?.length > 0 && (file || item.data?.length > 0)) {
          for (const info of videoInfo) {
            const inner = info.aggregation;
            const match = (file && item?.id === info.id && item) ||
                          (tv && inner?.episodeNumber != null && item.data.find(d => d.episode === inner.episodeNumber)) ||
                          (!file && !tv && inner?.name && item.data.find(d => d.name === inner.name));

            if (match) {
              Object.assign(info, inner);

              forEach(info as any, (key, value) => {
                if ((tv ? EPISODE_DETAILS :
                  file ? FILE_DETAILS :
                    season ? SEASON_DETAILS : MOVIE_DETAILS).has(key) && value != null && value !== '')
                  (match as any)[key] = value;
              });

              if (inner.playPoint != null)
                match.position = max(inner.playPoint / 1000, -1);

              if (isTvEpisode(match))
                await getShowInfo(match.data, { aggregation: info } as unknown as ShowInfo);
            }
          }
        }
      }

      if (showInfo.directors)
        item.directors = showInfo.directors.map(d => ({ name: d.name, profilePath: d.profilePath }));

      if (showInfo.actors)
        item.actors = showInfo.actors.map(a => ({ character: a.character, name: a.name, profilePath: a.profilePath }));

      if (showInfo.genres) {
        const genres = new Set<string>(showInfo.genres.map(g =>
          g.name
            .replace(/^Action & Adventure$/i, 'Action/Adventure')
            .replace(/^Sci-Fi & Fantasy$/i, 'Sci-fi/Fantasy')
            .replace(/^(Science Fiction|Science-Fiction)$/i, 'Sci-fi')
            .replace(/^War & Politics$/i, 'War/Politics')
        ));

        Array.from(genres).forEach(g => {
          const parts = g.split('/');

          if (parts.length > 1) {
            parts.forEach(p => genres.add(p));
            genres.delete(g);
          }
        });

        item.genres = Array.from(genres).sort(compareCaseSecondary);
      }

      if (isTvCollection(item) || isTvShow(item) || isTvSeason(item))
        await getShowInfo(item.data, showInfo?.aggregation as unknown as ShowInfo);
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

      for (const flag of ['isSD', 'is3d', 'isHD', 'isFHD', 'is4k', 'isHdr']) {
        if (data.find(v => v[flag]))
          (item as any)[flag] = true;
        else
          delete (item as any)[flag];
      }

      if (item.is3d || item.isHD || item.isFHD || item.is4k)
        delete item.isSD;
    }
  }
}

function findMatchingUri(items: LibraryItem[], uri: string, parent?: LibraryItem): LibraryItem {
  for (const item of items) {
    if (item.isAlias)
      continue;
    else if (parent && item.uri && paths.dirname(item.uri) === uri)
      return parent;
    else if (item.data?.length > 0 && item.collectionId !== -2) {
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
      id: ++nextId, parentId: -1, collectionId: -2, aggregationId: -1,
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

function findVideoAux(asFile: boolean, id: number, item: LibraryItem, canBeAlias?: boolean): LibraryItem {
  if ((!asFile || isFile(item)) && item.id === id && !item.isAlias)
    return item;
  else if (item.data && (canBeAlias || item.collectionId !== -2)) {
    for (const child of item.data) {
      const match = findVideoAux(asFile, id, child, !!canBeAlias);

      if (match)
        return match;
    }
  }

  if (canBeAlias == null)
    return findVideoAux(asFile, id, item, true);

  return null;
}

export function findVideo(id: number): LibraryItem {
  return findVideoAux(true, id, { id: -1, data: cachedLibrary.array } as LibraryItem);
}

export function findId(id: number): LibraryItem {
  return findVideoAux(false, id, { id: -1, data: cachedLibrary.array } as LibraryItem);
}

function findAliases(id: number, lib?: VideoLibrary): LibraryItem[] {
  return _findAliases(id, lib || cachedLibrary);
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
      pendingLibrary.progress = 77.8;
      sendStatus();
      pendingLibrary.status = LibraryStatus.MEDIA_DETAILS;
      await getShowInfo(pendingLibrary.array);
    }

    await addMappings();

    if (!quick)
      fixVideoFlagsAndEncoding(pendingLibrary.array);

    pendingLibrary.array.sort(librarySorter);
    pendingLibrary.status = LibraryStatus.DONE;
    pendingLibrary.lastUpdate = new Date().toISOString();
    pendingLibrary.progress = 100;
    cachedLibrary = pendingLibrary;
    mapDurations();
    sendStatus();

    stripBackLinks(cachedLibrary.array);
    await writeFile(libraryFile, JSON.stringify(cachedLibrary), 'utf8');
    addBackLinks(cachedLibrary.array);
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

function updateItemWatchedState(item: LibraryItem, state: boolean, position: number): void {
  if (item) {
    setWatched(item, state, true, position);

    const aliases = findAliases(item.id);

    aliases.forEach(a => setWatched(a, state, true, position));
    webSocketSend({ type: 'idUpdate', data: item.id });
    updateCache(item.id).finally();
  }
}

function collectIds(items?: LibraryItem[], idSet?: Set<number>): number[] {
  let atTop = false;

  if (!items || !idSet) {
    items = cachedLibrary?.array || [];
    idSet = new Set();
    atTop = true;
  }

  for (const child of items) {
    if (child.id > 0 && (isMovie(child) || isTvSeason(child)))
      idSet.add(child.id);

    if (child.data)
      collectIds(child.data, idSet);
  }

  if (atTop)
    return Array.from(idSet).sort((a, b) => a - b);
  else
    return null;
}

function findByUri(uri: string, canBeAlias = false, items?: LibraryItem[]): LibraryItem {
  if (!items)
    items = cachedLibrary?.array || [];

  for (const child of items) {
    if ((canBeAlias || !child.isAlias) && child.uri === uri)
      return child;
    else if (child.data && (canBeAlias || child.collectionId !== -2)) {
      const match = findByUri(uri, canBeAlias, child.data);

      if (match)
        return match;
    }
  }

  return null;
}

interface WatchInfo {
  id: number;
  position: number;
  watched: boolean;
}

async function watchCheck(id: number, position = -1): Promise<void> {
  let item = findId(id);

  while (item.parent && !isMovie(item) && !isTvSeason(item)) {
    item = item.parent;
    id = item.id;
  }

  try {
    const url = process.env.VS_ZIDOO_CONNECT + `Poster/v2/getDetail?id=${id}`;
    const response: ShowInfo = await requestJson(url);
    const statuses: WatchInfo[] = [];

    if (response.aggregation?.aggregations) {
      for (const agg of response.aggregation.aggregations) {
        if (agg.type === VType.TV_EPISODE && agg.aggregations) {
          for (const vAgg of agg.aggregations)
            statuses.push({ id: vAgg.id, watched: !!vAgg.watched, position: position > 0 ? position : vAgg.position });
        }
        else
          statuses.push({ id: agg.id, watched: !!agg.watched, position: position > 0 ? position : agg.position });
      }
    }
    else if (position > 0)
      statuses.push({ id, watched: item.watched, position });

    for (const status of statuses) {
      const vItem = findId(status.id);

      if (vItem?.watched !== status.watched || vItem?.position !== status.position)
        updateItemWatchedState(vItem, status.watched, status.position);
    }
  }
  catch {}
}

function monitorPlayer(): void {
  unref(setInterval(async () => {
    const lastPlayerAvailable = playerAvailable;
    const lastCurrentVideo = currentVideo;
    const lastCurrentVideoId = currentVideoId;
    const lastCurrentVideoPath = currentVideoPath;
    const lastCurrentVideoPosition = currentVideoPosition;

    try {
      const url = process.env.VS_ZIDOO_CONNECT + 'ZidooVideoPlay/getPlayStatus';
      const response: PlayStatus = await requestJson(url);

      playerAvailable = true;

      if (response.status === 200 && response.video?.path) {
        currentVideo = response.video.title || response.video.path;
        currentVideoPath = response.video.path.replace(/^[^#]*#[^/]*/, '').normalize();
        currentVideoPosition = response.video.currentPosition / 1000;

        const item = findByUri(currentVideoPath);
        const lastId = currentVideoId;

        if (item?.id > 0) {
          currentVideoId = item.id;
          await watchCheck(item.id, currentVideoPosition);
        }
        else
          currentVideoId = -1;

        if (lastId > 0 && lastId !== currentVideoId) {
          updateCache(lastId).finally();
          setTimeout(() => watchCheck(lastId), 1000);
        }
      }
      else {
        currentVideo = undefined;
        currentVideoPath = undefined;
        currentVideoPosition = -1;
        currentVideoId = -1;
      }
    }
    catch {
      playerAvailable = false;
      currentVideo = undefined;
      currentVideoId = -1;
      currentVideoPath = undefined;
      currentVideoPosition = -1;
    }

    if (lastPlayerAvailable !== playerAvailable ||
        lastCurrentVideo !== currentVideo ||
        lastCurrentVideoId !== currentVideoId ||
        lastCurrentVideoPath !== currentVideoPath ||
        lastCurrentVideoPosition !== currentVideoPosition)
      sendStatus();

    const now = processMillis();

    if (pendingLibrary)
      lastFullWatchStateCheck = now;
    else if (!watchCheckRunning &&
             (lastFullWatchStateCheck == null || lastFullWatchStateCheck < 0 ||
              lastFullWatchStateCheck + FULL_WATCH_CHECK_INTERVAL < now)) {
      lastFullWatchStateCheck = now;

      const ids = collectIds();
      let index = 0;
      async function watchCheckLoop(): Promise<void> {
        await watchCheck(ids[index++]);

        if (index < ids.length && !pendingLibrary)
          unref(setTimeout(watchCheckLoop, 500));
        else {
          watchCheckRunning = false;
          lastFullWatchStateCheck = now;
        }
      }

      if (ids.length > 0) {
        watchCheckRunning = true;
        watchCheckLoop().finally();
      }
    }
  }, 10000));
}

export function initLibrary(): void {
  let stats = existsSync(libraryFile) && lstatSync(libraryFile);

  if (stats) {
    try {
      cachedLibrary = JSON.parse(readFileSync(libraryFile).toString('utf8'));
      addBackLinks(cachedLibrary.array);
      mapDurations();
    }
    catch {
      stats = undefined;
    }
  }

  const age = stats ? +Date.now() - +stats.mtime : 0;

  if (!stats || age > DAY)
    updateLibrary().finally();
  else
    unref(pendingUpdate = setTimeout(() => {
      pendingUpdate = undefined;
      updateLibrary().finally();
    }, DAY - age));

  monitorPlayer();
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
    if (isFile(item) && item.streamUri) {
      try {
        const db = getDb();
        const row = await db.get('SELECT * FROM watched WHERE user = ? AND video = ?', user, hashUri(item.streamUri)) as PlaybackProgress;

        if (row) {
          item.duration = item.duration || row.duration;
          item.lastUserWatchTime = row.last_watched;
          item.positionUser = row.offset;
          item.watchedByUser = row.watched;
        }
        else {
          item.lastUserWatchTime = -1;
          item.positionUser = 0;
          item.watchedByUser = false;
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

let pendingLibUpdate: VideoLibrary;
let libUpdateTimer: any;

export async function updateCache(id: number): Promise<void> {
  const source = findId(id);

  if (!source || !await existsAsync(libraryFile))
    return;

  if (!pendingLibUpdate) {
    try {
      pendingLibUpdate = JSON.parse((await readFile(libraryFile)).toString('utf8')) as VideoLibrary;
    }
    catch {
      return;
    }
  }

  if (!pendingLibUpdate.array)
    return;

  function findTargetId(id: number, item?: LibraryItem): LibraryItem {
    if (item?.id === id)
      return item;
    else if (!item || item.data) {
      for (const child of item?.data || pendingLibUpdate.array) {
        const match = findTargetId(id, child);

        if (match)
          return match;
      }
    }

    return null;
  }

  const target = findTargetId(id);

  if (!target)
    return;

  syncValues(source, target);

  const aliases = findAliases(id, pendingLibUpdate);

  aliases.forEach(a => syncValues(source, a));

  if (!libUpdateTimer)
    libUpdateTimer = setTimeout(() => {
      const tempLib = pendingLibUpdate;

      pendingLibUpdate = undefined;
      libUpdateTimer = undefined;
      writeFile(libraryFile, JSON.stringify(tempLib), 'utf8');
    }, 2000);
}

async function setWatchedApi(item: LibraryItem, watched: number): Promise<any> {
  try {
    // Despite the parameter name 'aggregationId', this API uses plain-old 'id' instead.
    const url = process.env.VS_ZIDOO_CONNECT + `Poster/v2/markAsWatched?aggregationId=${item.id}&watched=${watched}`;
    const response = await requestJson(url);

    if (response.status === 200 && response.msg === 'success') {
      item.watched = !!watched;

      return null;
    }
    else
      return response;
  }
  catch {
    return { status: 500 };
  }
}

async function setWatchedMultiple(item: LibraryItem, watched: number): Promise<any> {
  if (!item?.data)
    return null;

  for (const child of item.data) {
    const response = isFile(child) ? await setWatchedApi(child, watched) : await setWatchedMultiple(child, watched);

    if (response)
      return response;
  }

  return null;
}

router.put('/set-watched', async (req, res) => {
  const id = toInt(req.query.id);
  const item = findId(id);

  if (!item) {
    res.sendStatus(500);
    return;
  }

  const watched = toInt(req.query.watched);
  const response = isFile(item) ? await setWatchedApi(item, watched) : await setWatchedMultiple(item, watched);

  if (!response) {
    updateItemWatchedState(item, !!watched, 0);
    jsonOrJsonp(req, res, response);
  }
  else if (response.status === 500 && !response.msg)
    res.sendStatus(500);
  else {
    res.status(response.status === 200 ? 400 : response.status);
    res.send(response.msg);
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
    response = findId(toNumber(req.query.id));

  if (response)
    await updateWatchInfo((response as VideoLibrary).array ?
      (response as VideoLibrary).array : [response as LibraryItem], username(req));

  removeBackLinks(response);

  if (toBoolean(req.query.test)) {
    const keep = new Set(['watched', 'name', 'title', 'type', 'id', 'aggregationId', 'position', 'playPoint',
                          'collectionId']);
    const skip = new Set(['audio', 'video', 'subtitle', 'actors', 'directors', 'genres']);
    function strip(obj: any): void {
      const keys = Object.keys(obj);
      for (const key of keys) {
        if (isObject(obj[key]) && !skip.has(key))
          strip(obj[key]);
        else if (!keep.has(key))
          delete obj[key];
      }
    }
    strip(response);
  }

  jsonOrJsonp(req, res, response);
});
