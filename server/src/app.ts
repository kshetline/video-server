// #!/usr/bin/env node
/*
  Copyright © 2023 Kerry Shetline, kerry@shetline.com

  MIT license: https://opensource.org/licenses/MIT

  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
  rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
  persons to whom the Software is furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
  Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
  WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
  COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import { execSync } from 'child_process';
import cookieParser from 'cookie-parser';
import express, { Express } from 'express';
import * as http from 'http';
import { asLines, forEach, isString, toBoolean, toInt, toNumber } from '@tubular/util';
import logger from 'morgan';
import * as paths from 'path';
import { jsonOrJsonp, noCache, normalizePort, timeStamp } from './vs-util';
import request from 'request';
import { requestJson } from 'by-request';
import { Collection, CollectionItem, CollectionStatus, MediaInfo, MediaInfoTrack, ShowInfo, Track, VType } from './shared-types';
import { abs, min } from '@tubular/math';
import { lstat, mkdir, readdir, writeFile } from 'fs/promises';
import { existsSync, mkdirSync, readFileSync, Stats } from 'fs';

const debug = require('debug')('express:server');

// Create HTTP server
const devMode = process.argv.includes('-d');
const allowCors = toBoolean(process.env.VC_ALLOW_CORS) || devMode;
const defaultPort = devMode ? 4201 : 8080;
const httpPort = normalizePort(process.env.VC_PORT || defaultPort);
const cacheDir = paths.join(process.cwd(), 'cache');
const app = getApp();
let httpServer: http.Server;
const MAX_START_ATTEMPTS = 3;
let startAttempts = 0;

if (!existsSync(cacheDir))
  mkdirSync(cacheDir);

const collectionFile = paths.join(cacheDir, 'collection.json');
let cachedCollection = { status: CollectionStatus.NOT_STARTED, progress: -1 } as Collection;
let pendingCollection: Collection;

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGUSR2', shutdown);
process.on('unhandledRejection', err => console.error(`${timeStamp()} -- Unhandled rejection:`, err));

createAndStartServer();

const comparator = new Intl.Collator('en', { caseFirst: 'upper' }).compare;
const SEASON_EPISODE = /\bS(\d{1,2})E(\d{1,3})\b/i;
const SPECIAL_EPISODE = /-M(\d\d?)-/;

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

function filter(item: CollectionItem): void {
  if (item) {
    const keys = Object.keys(item);

    for (const key of keys) {
      if (!FIELDS_TO_KEEP.has(key))
        delete (item as any)[key];
    }
  }
}

async function getChildren(parents: CollectionItem[], bonusDirs: Set<string>, directoryMap: Map<string, string[]>): Promise<void> {
  for (const parent of (parents || [])) {
    if (parent.videoinfo) {
      parent.duration = parent.videoinfo.duration;
      parent.uri = parent.videoinfo.uri;
      delete parent.videoinfo;
    }

    filter(parent);

    if (parent.type > VType.FILE) {
      const url = process.env.VS_ZIDOO_CONNECT + `ZidooPoster/getCollection?id=${parent.id}`;
      const data = (await requestJson(url) as CollectionItem).data;

      if (data) {
        parent.data = data;
        await getChildren(parent.data, bonusDirs, directoryMap);
      }
    }

    if (parent.type === VType.TV_EPISODE && parent.data?.length > 0) {
      const video = parent.data[0];
      let $ = SEASON_EPISODE.exec(video.title) || SEASON_EPISODE.exec(video.name) || SEASON_EPISODE.exec(video.uri);

      if ($) {
        parent.season = toInt($[1]);
        parent.episode = toInt($[2]);
      }
      else if (($ = SPECIAL_EPISODE.exec(video.name)) || ($ = SPECIAL_EPISODE.exec(video.title))) {
        parent.season = 0;
        parent.episode = toInt($[1]);
      }
    }

    if (parent.data?.length > 0 && parent.type === VType.TV_SEASON)
      parent.data.sort((a, b) => (a.episode || 0) - (b.episode || 0));

    let uri: string;

    if (parent.data?.length > 0) {
      if (parent.type === VType.TV_SHOW)
        uri = paths.dirname(parent.data[0]?.data[0]?.data[0]?.uri);
      else
        uri = parent.data[0].uri;
    }

    if (uri && (parent.type === VType.MOVIE || parent.type === VType.TV_SHOW || parent.type === VType.TV_SEASON)) {
      const basePath = paths.dirname(paths.join(process.env.VS_VIDEO_SOURCE, uri));

      for (const bonusDir of Array.from(bonusDirs)) {
        const checkPath = paths.join(basePath, bonusDir);

        if (directoryMap.has(checkPath))
          parent.extras = directoryMap.get(checkPath).map(file => paths.join(checkPath, file));
      }
    }

    if (parents === pendingCollection.array)
      pendingCollection.progress = min(pendingCollection.progress + 44 / 2.89 / pendingCollection.total, 39.7);
  }
}

async function getMediaInfo(parents: CollectionItem[]): Promise<void> {
  for (const parent of parents) {
    if (parent.type === VType.FILE) {
      const url = process.env.VS_ZIDOO_CONNECT + `Poster/v2/getVideoInfo?id=${parent.aggregationId}`;
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
              parent.title = track.Title || track.Movie;
              break;
            case 'Video':
              parent.aspectRatio = formatAspectRatio(track);
              parent.resolution = formatResolution(track);
              parent.video = parent.video ?? [];
              parent.video.push(t);
              break;
            case 'Audio':
              t.channels = channelString(track);
              parent.audio = parent.audio ?? [];
              parent.audio.push(t);
              break;
            case 'Text':
              parent.subtitle = parent.subtitle ?? [];
              parent.subtitle.push(t);
              break;
          }
        }
      }
    }
    else
      await getMediaInfo(parent.data);

    if (parents === pendingCollection.array)
      pendingCollection.progress = min(pendingCollection.progress + 110 / 2.89 / pendingCollection.total, 77.8);
  }
}

async function safeLstat(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  }
  catch (e) {
    if (e.code !== 'ENOENT')
      throw e;
  }

  return null;
}

async function existsAsync(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  }
  catch (e) {
    if (e.code !== 'ENOENT')
      throw e;
  }

  return false;
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
        pendingCollection.bonusFileCount += subCount;
      else {
        pendingCollection.mainFileCount += subCount;
      }

      const specialDir = /[•§]/.test(path) || /§.*\bSeason 0?1\b/.test(path);

      if (!isBonusDir && (specialDir && subCount === 0 || !specialDir && subCount > 0))
        pendingCollection.progress = min(pendingCollection.progress + 71 / 2.89 / pendingCollection.total, 24.5);
    }
    else {
      if (!map.has(dir))
        map.set(dir, []);

      map.get(dir).push(file);

      if (file.endsWith('.mkv'))
        ++count;
    }
  }

  return count;
}

const MOVIE_DETAILS = new Set(['certification', 'homepage', 'logo', 'overview', 'releaseDate', 'tagLine']);
const SEASON_DETAILS = new Set(['episodeCount', 'overview', 'posterPath', 'seasonNumber']);
const EPISODE_DETAILS = new Set(['airDate', 'episodeCount', 'overview', 'posterPath', 'seasonNumber']);

async function getShowInfo(parents: CollectionItem[]): Promise<void> {
  for (const parent of parents) {
    if (parent.type === VType.MOVIE || parent.type === VType.TV_SEASON) {
      const url = process.env.VS_ZIDOO_CONNECT + `Poster/v2/getDetail?id=${parent.id}`;
      const showInfo: ShowInfo = await requestJson(url);
      const topInfo = showInfo.aggregation?.aggregation;

      if (parent.type === VType.MOVIE) {
        if (topInfo) {
          forEach(topInfo, (key, value) => {
            if (MOVIE_DETAILS.has(key) && value)
              (parent as any)[key] = value;
          });
        }
      }
      else {
        if (topInfo) {
          forEach(topInfo, (key, value) => {
            if (SEASON_DETAILS.has(key) && value)
              (parent as any)[key] = value;
          });
        }

        const episodeInfo = showInfo.aggregation?.aggregations;

        if (episodeInfo?.length > 0 && parent.data?.length > 0) {
          for (const info of episodeInfo) {
            const inner = info.aggregation;
            const match = inner?.episodeNumber != null && parent.data.find(d => d.episode === inner.episodeNumber);

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
        parent.directors = showInfo.directors.map(d => ({ name: d.name, profilePath: d.profilePath }));

      if (showInfo.actors)
        parent.actors = showInfo.actors.map(a => ({ character: a.character, name: a.name, profilePath: a.profilePath }));

      if (showInfo.genres)
        parent.genres = showInfo.genres.map(g => g.name);
    }
    else
      await getShowInfo(parent.data);

    if (parents === pendingCollection.array)
      pendingCollection.progress = min(pendingCollection.progress + 64 / 2.89 / pendingCollection.total, 99.4);
  }
}

function fixVideoFlags(parents: CollectionItem[]): void {
  for (const parent of parents) {
    if (parent.data?.length > 0)
      fixVideoFlags(parent.data);
  }

  for (const parent of parents) {
    delete parent.is2k;

    if (parent.type === VType.FILE) {
      if (!parent.is3d)
        delete parent.is3d;

      delete parent.isHD;
      delete parent.isFHD;
      delete parent.is4k;
      delete parent.isHdr;

      switch (parent.resolution) {
        case 'HD': parent.isHD = true; break;
        case 'FHD': parent.isFHD = true; break;
        case 'UHD': parent.is4k = true; break;
      }

      if (/\bHDR/.test((parent.video || [])[0]?.codec || ''))
        parent.isHdr = true;
    }
    else {
      const data: any[] = parent.data || [];

      for (const flag of ['is3d', 'isHD', 'isFHD', 'is4k', 'isHdr']) {
        if (data.find(v => v[flag]))
          (parent as any)[flag] = true;
        else
          delete (parent as any)[flag];
      }
    }
  }
}

async function updateCollection(): Promise<void> {
  if (pendingCollection)
    return;

  const url = process.env.VS_ZIDOO_CONNECT + 'Poster/v2/getFilterAggregations?type=0&start=0';
  const bonusDirs = new Set(['-Extras-']);

  pendingCollection = await requestJson(url) as Collection;
  pendingCollection.status = CollectionStatus.INITIALIZED;
  pendingCollection.progress = 0;
  pendingCollection.mainFileCount = 0;
  pendingCollection.bonusFileCount = 0;

  if (cachedCollection.status === CollectionStatus.NOT_STARTED)
    cachedCollection = pendingCollection;

  const directoryMap = new Map<string, string[]>();
  await getDirectories(process.env.VS_VIDEO_SOURCE, bonusDirs, directoryMap);
  pendingCollection.progress = 24.5;
  pendingCollection.status = CollectionStatus.BONUS_MATERIAL_LINKED;
  await getChildren(pendingCollection.array, bonusDirs, directoryMap);
  pendingCollection.progress = 39.7;
  pendingCollection.status = CollectionStatus.ALL_VIDEOS;
  await getMediaInfo(pendingCollection.array);
  fixVideoFlags(pendingCollection.array);
  pendingCollection.progress = 77.8;
  pendingCollection.status = CollectionStatus.MEDIA_DETAILS;
  await getShowInfo(pendingCollection.array);
  pendingCollection.status = CollectionStatus.DONE;
  pendingCollection.lastUpdate = new Date().toISOString();
  pendingCollection.progress = 100;
  cachedCollection = pendingCollection;
  pendingCollection = undefined;

  await writeFile(collectionFile, JSON.stringify(cachedCollection), 'utf8');
}

function createAndStartServer(): void {
  console.log(`*** Starting server on port ${httpPort} at ${timeStamp()} ***`);
  httpServer = http.createServer(app);
  httpServer.on('error', onError);
  httpServer.on('listening', onListening);

  if (existsSync(collectionFile))
    cachedCollection = JSON.parse(readFileSync(collectionFile).toString('utf8'));
  else
    updateCollection().finally();

  httpServer.listen(httpPort);
}

function onError(error: any): void {
  if (error.syscall !== 'listen')
    throw error;

  const bind = isString(httpPort) ? 'Pipe ' + httpPort : 'Port ' + httpPort;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges');
      process.exit(1);
    // eslint-disable-next-line no-fallthrough
    case 'EADDRINUSE':
      console.error(bind + ' is already in use');

      if (!canReleasePortAndRestart())
        process.exit(1);

      break;
    default:
      throw error;
  }
}

function onListening(): void {
  const addr = httpServer.address();
  const bind = isString(addr) ? 'pipe ' + addr : 'port ' + addr.port;

  debug('Listening on ' + bind);
}

function canReleasePortAndRestart(): boolean {
  if (process.env.USER !== 'root' || !toBoolean(process.env.AWC_LICENSED_TO_KILL) || ++startAttempts > MAX_START_ATTEMPTS)
    return false;

  try {
    const lines = asLines(execSync('netstat -pant').toString());

    for (const line of lines) {
      const $ = new RegExp(String.raw`^tcp.*:${httpPort}\b.*\bLISTEN\b\D*(\d+)\/node`).exec(line);

      if ($) {
        const signal = (startAttempts > 1 ? '-9 ' : '');

        console.warn('%s -- Killing process: %s', timeStamp(), $[1]);
        execSync(`kill ${signal}${$[1]}`);

        return true;
      }
    }
  }
  catch (err) {
    console.log(`${timeStamp()} -- Failed to kill process using port ${httpPort}: ${err}`);
  }

  return false;
}

function shutdown(signal?: string): void {
  if (devMode && signal === 'SIGTERM')
    return;

  console.log(`\n*** ${signal ? signal + ': ' : ''}closing server at ${timeStamp()} ***`);
  // Make sure that if the orderly clean-up gets stuck, shutdown still happens.
  httpServer.close(() => process.exit(0));
}

function getApp(): Express {
  const theApp = express();

  theApp.use(logger('[:date[iso]] :remote-addr - :remote-user ":method :url HTTP/:http-version" :status :res[content-length] :response-time'));
  theApp.use(express.json());
  theApp.use(express.urlencoded({ extended: false }));
  theApp.use(cookieParser());

  theApp.use(express.static(paths.join(__dirname, 'public')));
  theApp.get('/', (_req, res) => {
    res.send('Static home file not found');
  });

  if (allowCors) {
    // see: http://stackoverflow.com/questions/7067966/how-to-allow-cors-in-express-nodejs
    theApp.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      // intercept OPTIONS method
      if (req.method === 'OPTIONS')
        res.send(200);
      else {
        next();
      }
    });
  }

  theApp.get('/api/collection', async (req, res) => {
    noCache(res);
    jsonOrJsonp(req, res, cachedCollection);
  });

  theApp.get('/api/poster', async (req, res) => {
    let cachePath = paths.join(cacheDir, 'poster', req.query.id + '.' + req.query.cs);

    if (req.query.w)
      cachePath += '-' + req.query.w;

    if (req.query.h)
      cachePath += '-' + req.query.h;

    cachePath += (req.query.w || req.query.h ? '.png' : '.jpg');

    if (await existsAsync(cachePath))
      res.sendFile(cachePath);
    else {
      let url = `${process.env.VS_ZIDOO_CONNECT}Poster/v2/getPoster?id=${req.query.id}`;

      if (req.query.w)
        url += '&w=' + req.query.w;

      if (req.query.h)
        url += '&h=' + req.query.h;

      request(url, { encoding: 'binary' }, async (error, _response, body) => {
        if (error)
          return;

        if (!await existsAsync(paths.dirname(cachePath)))
          await mkdir(paths.dirname(cachePath));

        await writeFile(cachePath, body, 'binary');
      }).pipe(res);
    }
  });

  theApp.get('/api/profile-image/:image', async (req, res) => {
    const url = process.env.VS_PROFILE_IMAGE_BASE + req.params.image;

    request(url).pipe(res);
  });

  return theApp;
}
