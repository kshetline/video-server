import { Router } from 'express';
import {
  Cut, LibraryItem, LibraryStatus, MediaInfo, MediaInfoTrack, ShowInfo, Track, VideoLibrary, VType
} from './shared-types';
import { forEach, isNumber, toInt, toNumber } from '@tubular/util';
import { abs, min } from '@tubular/math';
import { requestJson } from 'by-request';
import paths from 'path';
import { readdir, writeFile } from 'fs/promises';
import { cacheDir, jsonOrJsonp, noCache, safeLstat } from './vs-util';
import { existsSync, lstatSync, readFileSync } from 'fs';

export const router = Router();

const comparator = new Intl.Collator('en', { caseFirst: 'upper' }).compare;
const SEASON_EPISODE = /\bS(\d{1,2})E(\d{1,3})\b/i;
const SPECIAL_EPISODE = /-M(\d\d?)-/;

const DIRECTORS = /\(.*\bDirector['’]s\b/i;
const FINAL = /\(.*\bFinal\b/i;
const EXTENDED = /(\/|\(.*)\bExtended\b/i;
const INT_THEATRICAL = /\(.*\bInternational Theatrical\b/i;
const SPECIAL_EDITION = /\bspecial edition\b/i;
const UNRATED = /\bunrated\b/i;
const THEATRICAL = /(\/|\(.*)\b(Original|Theatrical)\b/i;

const libraryFile = paths.join(cacheDir, 'library.json');
export let cachedLibrary = { status: LibraryStatus.NOT_STARTED, progress: -1 } as VideoLibrary;
export let pendingLibrary: VideoLibrary;

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

  if (abs(ratio - 1.33) < 0.02)
    return '4:3';
  else if (abs(ratio - 1.78) < 0.02)
    return '16:9';
  else if (abs(ratio - 1.85) < 0.02)
    return 'Wide';
  else
    return ratio.toFixed(2) + ':1';
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
    if (item.videoinfo) {
      item.duration = item.videoinfo.duration;
      item.uri = item.videoinfo.uri;

      if (item.videoinfo.lastWatchTime >= 0 && item.videoinfo.playPoint / item.videoinfo.duration > 0.5)
        item.watched = true;

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
      if (DIRECTORS.test(item.uri))
        item.cut = Cut.DIRECTORS;
      else if (FINAL.test(item.uri))
        item.cut = Cut.FINAL;
      else if (EXTENDED.test(item.uri))
        item.cut = Cut.EXTENDED;
      else if (INT_THEATRICAL.test(item.uri))
        item.cut = Cut.INT_THEATRICAL;
      else if (SPECIAL_EDITION.test(item.uri))
        item.cut = Cut.SPECIAL_EDITION;
      else if (UNRATED.test(item.uri))
        item.cut = Cut.UNRATED;
      else if (THEATRICAL.test(item.uri))
        item.cut = Cut.THEATRICAL;
      else
        item.cut = Cut.NA;
    }

    if (item.type === VType.TV_EPISODE && item.data?.length > 0) {
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

    if (item.data?.length > 0 && item.type === VType.TV_SEASON)
      item.data.sort((a, b) => (a.episode || 0) - (b.episode || 0));

    let uri: string;

    if (item.data?.length > 0) {
      if (item.type === VType.TV_SHOW)
        uri = paths.dirname(item.data[0]?.data[0]?.data[0]?.uri);
      else
        uri = item.data[0].uri;
    }

    if (uri && (item.type === VType.MOVIE || item.type === VType.TV_SHOW || item.type === VType.TV_SEASON)) {
      const basePath = paths.dirname(paths.join(process.env.VS_VIDEO_SOURCE, uri));

      for (const bonusDir of Array.from(bonusDirs)) {
        const checkPath = paths.join(basePath, bonusDir);

        if (directoryMap.has(checkPath))
          item.extras = directoryMap.get(checkPath).map(
            file => paths.join(checkPath, file).substring(process.env.VS_VIDEO_SOURCE.length).replace(/\\/g, '/'));
      }
    }

    if (items === pendingLibrary.array)
      pendingLibrary.progress = min(pendingLibrary.progress + 44 / 2.89 / pendingLibrary.total, 39.7);
  }
}

async function getMediaInfo(items: LibraryItem[]): Promise<void> {
  for (const item of (items || [])) {
    if (item.type === VType.FILE) {
      const url = process.env.VS_ZIDOO_CONNECT + `Poster/v2/getVideoInfo?id=${item.aggregationId}`;
      const data: any = await requestJson(url);
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
              item.aspectRatio = formatAspectRatio(track);
              item.resolution = formatResolution(track);
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

    if (items === pendingLibrary.array)
      pendingLibrary.progress = min(pendingLibrary.progress + 110 / 2.89 / pendingLibrary.total, 77.8);
  }
}

async function getDirectories(dir: string, bonusDirs: Set<string>, map: Map<string, string[]>): Promise<number> {
  const files = (await readdir(dir)).sort(comparator);
  let count = 0;

  for (const file of files) {
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

      if (!isBonusDir && (specialDir && subCount === 0 || !specialDir && subCount > 0))
        pendingLibrary.progress = min(pendingLibrary.progress + 71 / 2.89 / pendingLibrary.total, 24.5);
    }
    else {
      if (!map.has(dir))
        map.set(dir, []);

      if (file.endsWith('.mkv')) {
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
  for (const item of items) {
    if (isNumber((item as any).seasonNumber)) {
      item.season = (item as any).seasonNumber;
      delete (item as any).seasonNumber;
    }

    if (item.type === VType.MOVIE || item.type === VType.TV_SHOW ||
      item.type === VType.TV_SEASON || item.type === VType.TV_COLLECTION) {
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

      if (item.type === VType.MOVIE) {
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

      if (item.type === VType.TV_COLLECTION || item.type === VType.TV_SHOW)
        await getShowInfo(item.data);
    }
    else
      await getShowInfo(item.data);

    if (items === pendingLibrary.array)
      pendingLibrary.progress = min(pendingLibrary.progress + 64 / 2.89 / pendingLibrary.total, 99.4);
  }
}

function fixVideoFlags(items: LibraryItem[]): void {
  for (const item of items) {
    if (item.data?.length > 0)
      fixVideoFlags(item.data);
  }

  for (const item of items) {
    delete item.is2k;

    if (item.type === VType.FILE) {
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

export async function updateLibrary(): Promise<void> {
  if (pendingLibrary)
    return;

  const url = process.env.VS_ZIDOO_CONNECT + 'Poster/v2/getFilterAggregations?type=0&start=0';
  const bonusDirs = new Set(['-Extras-']);

  pendingLibrary = await requestJson(url) as VideoLibrary;
  pendingLibrary.status = LibraryStatus.INITIALIZED;
  pendingLibrary.progress = 0;
  pendingLibrary.mainFileCount = 0;
  pendingLibrary.bonusFileCount = 0;

  if (cachedLibrary.status === LibraryStatus.NOT_STARTED)
    cachedLibrary = pendingLibrary;

  const directoryMap = new Map<string, string[]>();
  await getDirectories(process.env.VS_VIDEO_SOURCE, bonusDirs, directoryMap);
  pendingLibrary.progress = 24.5;
  pendingLibrary.status = LibraryStatus.BONUS_MATERIAL_LINKED;
  await getChildren(pendingLibrary.array, bonusDirs, directoryMap);
  pendingLibrary.progress = 39.7;
  pendingLibrary.status = LibraryStatus.ALL_VIDEOS;
  await getMediaInfo(pendingLibrary.array);
  fixVideoFlags(pendingLibrary.array);
  pendingLibrary.progress = 77.8;
  pendingLibrary.status = LibraryStatus.MEDIA_DETAILS;
  await getShowInfo(pendingLibrary.array);
  pendingLibrary.status = LibraryStatus.DONE;
  pendingLibrary.lastUpdate = new Date().toISOString();
  pendingLibrary.progress = 100;
  cachedLibrary = pendingLibrary;
  pendingLibrary = undefined;

  await writeFile(libraryFile, JSON.stringify(cachedLibrary), 'utf8');
}

export function initLibrary(): void {
  const stats = existsSync(libraryFile) && lstatSync(libraryFile);

  if (stats)
    cachedLibrary = JSON.parse(readFileSync(libraryFile).toString('utf8'));

  if (!stats || +stats.mtime < +Date.now() - 86_400_000)
    updateLibrary().finally();
}

router.get('/', async (req, res) => {
  noCache(res);
  jsonOrJsonp(req, res, cachedLibrary);
});