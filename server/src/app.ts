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
import { requestJson } from 'by-request';
import { Aggregation, CollectionItem, CollectionStatus, MediaInfo, MediaInfoTrack, ShowInfo, Track, VType } from './shared-types';
import { abs } from '@tubular/math';
import { lstat, readdir } from 'fs/promises';
import { Stats } from 'fs';

const debug = require('debug')('express:server');

// Create HTTP server
const devMode = process.argv.includes('-d');
const allowCors = toBoolean(process.env.VC_ALLOW_CORS) || devMode;
const defaultPort = devMode ? 4201 : 8080;
const httpPort = normalizePort(process.env.VC_PORT || defaultPort);
const app = getApp();
let httpServer: http.Server;
const MAX_START_ATTEMPTS = 3;
let startAttempts = 0;

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGUSR2', shutdown);
process.on('unhandledRejection', err => console.error(`${timeStamp()} -- Unhandled rejection:`, err));

createAndStartServer();

const comparator = new Intl.Collator('en', { caseFirst: 'upper' }).compare;
let cachedCollection = { status: CollectionStatus.NOT_STARTED } as Aggregation;
let pendingCollection: Aggregation;
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

async function getChildren(parents: CollectionItem[], directoryMap: Map<string, string[]>): Promise<void> {
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
        await getChildren(parent.data, directoryMap);
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

    if (parent.data?.length > 0 && parent.data[0].uri &&
        (parent.type === VType.MOVIE || parent.type === VType.TV_SHOW || parent.type === VType.TV_SEASON)) {
      const basePath = paths.dirname(paths.join(process.env.VS_VIDEO_SOURCE, parent.data[0].uri));
      const checkPath = paths.join(basePath, '-Extras-'); // TODO: Also bonus disc folders

      if (directoryMap.has(checkPath))
        parent.extras = directoryMap.get(checkPath).map(file => paths.join(checkPath, file));
    }
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

async function getDirectories(dir: string, map?: Map<string, string[]>): Promise<Map<string, string[]>> {
  if (!map)
    map = new Map();

  const files = (await readdir(dir)).sort(comparator);

  for (const file of files) {
    const path = paths.join(dir, file);
    const stat = await safeLstat(path);

    if (file === '.' || file === '..' || stat.isSymbolicLink() || file.endsWith('~')) {}
    else if (stat.isDirectory())
      await getDirectories(path, map);
    else {
      if (!map.has(dir))
        map.set(dir, []);

      map.get(dir).push(file);
    }
  }

  return map;
}

const MOVIE_DETAILS = new Set(['certification', 'homepage', 'logo', 'overview', 'releaseDate', 'tagLine']);
const SEASON_DETAILS = new Set(['episodeCount', 'overview', 'posterPath', 'seasonNumber']);
const EPISODE_DETAILS = new Set(['episodeCount', 'overview', 'posterPath', 'seasonNumber']);

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
    }
    else
      await getShowInfo(parent.data);
  }
}

async function updateCollection(): Promise<void> {
  const url = process.env.VS_ZIDOO_CONNECT + 'Poster/v2/getFilterAggregations?type=0&start=0';

  pendingCollection = await requestJson(url) as Aggregation;
  pendingCollection.status = CollectionStatus.INITIALIZED;

  if (cachedCollection.status === CollectionStatus.NOT_STARTED)
    cachedCollection = pendingCollection;

  const directoryMap = await getDirectories(process.env.VS_VIDEO_SOURCE);

  pendingCollection.status = CollectionStatus.BONUS_MATERIAL_LINKED;
  await getChildren(pendingCollection.array, directoryMap);
  pendingCollection.status = CollectionStatus.ALL_VIDEOS;
  await getMediaInfo(pendingCollection.array);
  pendingCollection.status = CollectionStatus.MEDIA_DETAILS;
  await getShowInfo(pendingCollection.array);
  pendingCollection.status = CollectionStatus.DONE;
  pendingCollection.lastUpdate = new Date().toISOString();
  cachedCollection = pendingCollection;
  pendingCollection = undefined;
}

function createAndStartServer(): void {
  console.log(`*** Starting server on port ${httpPort} at ${timeStamp()} ***`);
  httpServer = http.createServer(app);
  httpServer.on('error', onError);
  httpServer.on('listening', onListening);
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

  theApp.get('/api/aggregations', async (req, res) => {
    noCache(res);
    jsonOrJsonp(req, res, cachedCollection);
  });

  return theApp;
}
