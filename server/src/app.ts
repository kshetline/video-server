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

import { asLines, encodeForUri, isString, makePlainASCII, processMillis, toBoolean, toInt } from '@tubular/util';
import fs, { readFileSync } from 'fs';
import * as paths from 'path';

process.chdir(__dirname);

if (process.cwd().endsWith('tsc-out'))
  process.chdir('..');

for (let i = 2; i < process.argv.length; ++i) {
  if (process.argv[i] === '-env') {
    const envFile = process.argv[i + 1] || '.env';
    const vars = asLines(readFileSync(envFile).toString()).map(line => /^([^=]+)=(.*)$/.exec(line))
      .filter(pair => pair != null).map(pair => ({ name: pair[1].trim(), value: pair[2] }));

    vars.forEach(p => process.env[p.name] = p.value);
  }
}

import { execSync } from 'child_process';
import cookieParser from 'cookie-parser';
import express, { Express, Request, Response } from 'express';
import * as http from 'http';
import * as https from 'https';
import { WebSocketServer } from 'ws';
import logger from 'morgan';
import {
  existsAsync, getIp, getRemoteAddress, isAdmin, isDemo, jsonOrJsonp, noCache, normalizePort, safeLstat,
  safeUnlink, setWebSocketServer, timeStamp, unref, webSocketSend
} from './vs-util';
import { Resolver } from 'node:dns';
import {
  cachedLibrary, currentVideo, currentVideoId, currentVideoPath, currentVideoPosition, findVideo, initLibrary, pendingLibrary,
  playerAvailable, router as libraryRouter
} from './library-router';
import { router as imageRouter } from './image-router';
import { router as streamingRouter } from './streaming-router';
import { adminProcessing, currentFile, currentOp, encodeProgress, processArgs, router as adminRouter, statsInProgress, stopPending, updateProgress } from './admin-router';
import { LibraryItem, LibraryStatus, PlayStatus, ServerStatus, User, UserSession } from './shared-types';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { isFile, sleep, toStreamPath } from './shared-utils';
import { readdir } from 'fs/promises';
import { requestJson, requestText } from 'by-request';
import { closeSettings, getDb, openSettings, users } from './settings';
import { doZidooDbMaintenance } from './zidoo-db-maintenance';
import { cacheDir } from './shared-values';
import { max } from '@tubular/math';

const debug = require('debug')('express:server');

const REQUIRED_HOST = process.env.VS_REQUIRED_HOST;

// Create HTTP server
const devMode = process.argv.includes('-d');
const allowCors = toBoolean(process.env.VS_ALLOW_CORS) || devMode;
const defaultPort = devMode ? 4201 : 8080;
const httpPort = normalizePort(process.env.VS_PORT || defaultPort);
const wsPort = toInt(process.env.VS_WEB_SOCKET_PORT);
const insecurePort = normalizePort(process.env.VS_INSECURE_PORT);
const useHttps = toBoolean(process.env.VS_USE_HTTPS);
const app = getApp();
let httpServer: http.Server | https.Server;
let insecureServer: http.Server;
let wsServer: WebSocketServer;
const MAX_START_ATTEMPTS = 3;
let startAttempts = 0;
let hostIps: string[];
const blockedIps = new Map<string, number>();

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGUSR2', shutdown);
process.on('unhandledRejection', err => console.error(`${timeStamp()} -- Unhandled rejection:`, err));

const CACHE_CHECK_INTERVAL = 14_400_000; // Four hours
const CACHE_MAX_AGE = 604_800_000; // One week
const EXTENDED_COOKIE_LIFE = 3_600_000; // One hour
const BAD_REQUEST_COUNT = 3;
const BAD_REQUEST_DELAY = 30_000; // 30 seconds
const IP_BLOCK_TIME = 600_000; // 10 minutes
let cacheCheckTimer: any;

createAndStartServer();

async function cacheCheck(dir = cacheDir, depth = 0): Promise<void> {
  try {
    const files = (await readdir(dir)).filter(f => !f.startsWith('.') && f !== 'library.json');

    for (const file of files) {
      const path = paths.join(dir, file);
      const stat = await safeLstat(path);

      if (stat.isDirectory())
        await cacheCheck(path, depth + 1);
      else if (+stat.mtime + CACHE_MAX_AGE < Date.now())
        await safeUnlink(path);
    }
  }
  catch {}

  if (depth === 0) {
    cacheCheckTimer = setTimeout(() => cacheCheck(), CACHE_CHECK_INTERVAL);
    unref(cacheCheckTimer);
  }
}

function createAndStartServer(): void {
  console.log(`*** Starting server on port ${httpPort} at ${timeStamp()}${
    wsPort ? ', websocket on port ' + (wsPort < 0 ? httpPort : wsPort) : ''} ***`);

  openSettings().catch(err => console.error('Failed to open settings DB:', err));
  httpServer = useHttps ? https.createServer({
    key: fs.readFileSync(process.env.VS_KEY),
    cert: fs.readFileSync(process.env.VS_CERT)
  }, app) :
    http.createServer(app);
  httpServer.on('error', onError);
  httpServer.on('listening', onListening);

  initLibrary();

  if (useHttps && insecurePort) {
    insecureServer = http.createServer(app);
    insecureServer.on('error', onError);
    insecureServer.on('listening', onListening);
    insecureServer.listen(insecurePort);
  }

  if (wsPort) {
    let tries = 10;
    let retrying = false;

    function retry(err: any): void {
      retrying = true;

      if (retrying)
        return;

      if (--tries === 0)
        throw err;
      else {
        console.warn('Trying again to start websocket server...');
        setTimeout(startWebSocketServer, 500);
      }
    }

    function startWebSocketServer(): void {
      retrying = false;

      try {
        if (wsPort < 0 || wsPort === httpPort)
          wsServer = new WebSocketServer({ server: httpServer });
        else {
          const server = useHttps ? https.createServer({
            key: fs.readFileSync(process.env.VS_KEY),
            cert: fs.readFileSync(process.env.VS_CERT)
          }) :
            http.createServer();
          server.once('error', err => retry(err));
          wsServer = new WebSocketServer({ server });
          wsServer.once('error', err => retry(err));
          server.listen(wsPort);
        }
      }
      catch (err) {
        retry(err);
      }

      setWebSocketServer(wsServer);
    }

    startWebSocketServer();
  }

  httpServer.listen(httpPort);
  cacheCheckTimer = setTimeout(() => cacheCheck(), CACHE_CHECK_INTERVAL);

  doZidooDbMaintenance().finally();
}

function onError(error: any): void {
  if (error.syscall !== 'listen')
    throw error;

  const port = (/:(\d+)$/.exec(error.message) || ['', httpPort.toString()])[1];
  const bind = isString(httpPort) ? 'Pipe ' + port : 'Port ' + port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges');
      process.exit(1);
    // eslint-disable-next-line no-fallthrough
    case 'EADDRINUSE':
      console.error(bind + ' is already in use');

      if (!canReleasePortAndRestart(port))
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

function canReleasePortAndRestart(port: string): boolean {
  if (process.env.USER !== 'root' || !toBoolean(process.env.VS_LICENSED_TO_KILL) || ++startAttempts > MAX_START_ATTEMPTS)
    return false;

  try {
    const lines = asLines(execSync('netstat -pant').toString());

    for (const line of lines) {
      const $ = new RegExp(String.raw`^tcp.*:${port}\b.*\bLISTEN\b\D*(\d+)\/node`).exec(line);

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

  let cbCount = 0;
  const closeCheck = (closeNow = false): void => {
    if (closeNow || ++cbCount === 4)
      process.exit(0);
  };

  // Make sure that if the orderly clean-up gets stuck, shutdown still happens.
  if (insecureServer)
    insecureServer.close(() => closeCheck());

  if (wsServer)
    wsServer.close(() => closeCheck());

  httpServer.close(() => closeCheck());
  closeSettings().finally(() => closeCheck());
  unref(setTimeout(() => closeCheck(true), 3000));
}

function getStatus(remote?: string): ServerStatus {
  const status: ServerStatus = {
    currentFile,
    currentOp,
    currentVideo,
    currentVideoId,
    currentVideoPath,
    currentVideoPosition,
    encodeProgress,
    lastUpdate: cachedLibrary?.lastUpdate,
    ready: cachedLibrary?.status === LibraryStatus.DONE,
    playerAvailable,
    processArgs,
    processing: adminProcessing || statsInProgress || !!pendingLibrary,
    stopPending,
    updateProgress: -1,
    wsPort
  };

  if (remote)
    status.localAccess = remote === '1' || remote === '127.0.0.1' || remote?.startsWith('192.168.') ||
      (hostIps || []).indexOf(remote) >= 0;

  if (pendingLibrary)
    status.updateProgress = pendingLibrary.progress;
  else if (updateProgress >= 0)
    status.updateProgress = updateProgress;

  return status;
}

let statusTimer: any;
let statusTime = 0;

export function sendStatus(): void {
  if (wsServer) {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = undefined;
    }

    if (!statusTime)
      statusTime = processMillis();

    statusTimer = setTimeout(() => {
      statusTimer = undefined;
      statusTime = 0;
      webSocketSend({ type: 'status', data: getStatus() });
    }, max(1000 + statusTime - processMillis(), 0));
  }
}

function getApp(): Express {
  const theApp = express();

  theApp.use((req, res, next) => {
    const now = processMillis();
    const ips = Array.from(blockedIps.keys());

    for (const ip of ips) {
      const block = blockedIps.get(ip);

      if (block > 0 && block < now - IP_BLOCK_TIME) {
        console.log(timeStamp(), 'Unblocking:', ip);
        blockedIps.delete(ip);
      }
    }

    const ip = getIp(req);
    const block = blockedIps.get(ip);

    if (!block || block < 0)
      next();
    else
      unref(setTimeout(() => res.sendStatus(429), BAD_REQUEST_DELAY));
  });

  theApp.use(logger('[:date[iso]] :remote-addr - :remote-user ":method :url HTTP/:http-version" :status :res[content-length] :response-time'));
  theApp.use(express.json());
  theApp.use(express.urlencoded({ extended: false }));
  theApp.use(cookieParser());

  // hashed_password = crypto.pbkdf2Sync("password", salt, 100000, 64, 'sha512').toString('hex')
  theApp.use((req, res, next) => {
    const token = (req.cookies as NodeJS.Dict<string>).vs_jwt;
    const userInfo = token?.split('.')[1];

    if (/^\/(ab2g|ab2h|admin|app|apps|backup|blog|cgi-bin|cms|crm|laravel|lib|panel|password|phpunit|shell|systembc|test|V2|workspace|ws|yii|zend)/.test(req.url)) {
      const ip = getIp(req);
      const block = blockedIps.get(ip);

      if (block == null || block < 0) {
        console.log(timeStamp(), 'Blocking:', ip);
        blockedIps.set(ip, processMillis());
      }

      unref(setTimeout(() => res.sendStatus(403), BAD_REQUEST_DELAY));
    }
    else if (!/^\/api\//.test(req.url) || /^\/api\/(login|status)\b/.test(req.url))
      next();
    else if (!userInfo)
      res.sendStatus(401);
    else {
      jwt.verify(token, process.env.VS_TOKEN_SECRET as string, (err: any, user: any) => {
        if (err) {
          if (err.name === 'TokenExpiredError')
            res.status(440);
          else if (err.name === 'JsonWebTokenError')
            res.status(401);
          else
            res.status(403);

          res.send(`${err.name}: ${err.message}`);
        }
        else {
          const role = users.find(u => u.name === user.username)?.role;
          (req as any).user = { name: user.username, role, time_to_expire: user.exp };
          next();
        }
      });
    }
  });

  theApp.use((req, res, next) => {
    if (!REQUIRED_HOST || req.hostname === 'localhost' || req.hostname === REQUIRED_HOST) {
      if (!req.secure && insecureServer)
        res.redirect(`https://${req.headers.host.toString().replace(/:\d+$/, '')}${req.path}`);
      else
        next();
    }
    else
      res.status(403).end();
  });

  theApp.use(express.static('public'));
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

  function sendJwt(user: User, res: Response): void {
    const expiresIn = user.time_to_expire || 3600; // In seconds
    const expiration = Date.now() + expiresIn * 1000;
    const token = jwt.sign({ username: user.name }, process.env.VS_TOKEN_SECRET, { expiresIn });
    const session: UserSession = { name: user.name, role: user.role, expiration };

    res.cookie('vs_jwt', token, { secure: useHttps, httpOnly: true, expires: new Date(expiration + EXTENDED_COOKIE_LIFE) });
    res.json(session);
  }

  theApp.post('/api/login', async (req, res) => {
    const username = req.body.user?.toString();
    const pwd = req.body.pwd?.toString() || '';
    const db = getDb();
    const ip = getIp(req);
    const time = new Date().toISOString();

    for (const user of users) {
      if (user.name === username) {
        try {
          const hashed = await new Promise((resolve, reject) => {
            crypto.pbkdf2(pwd, process.env.VS_SALT, 100000, 64, 'sha512', (err, key) => {
              if (err)
                reject(err);
              else
                resolve(key.toString('hex'));
            });
          });

          if (hashed === user.hash) {
            sendJwt(user, res);
            await db.run('INSERT INTO logins (user, time, ip) VALUES (?, ?, ?)', username, time, ip);
            return;
          }
        }
        catch {}

        break;
      }
    }

    await db.run('INSERT INTO logins (user, time, ip, bad_pw) VALUES (?, ?, ?, ?)',
      username, time, ip, pwd);
    res.status(403).end();
  });

  theApp.get('/api/renew', async (req, res) => {
    sendJwt((req as any).user, res);
  });

  theApp.use('/api/library', libraryRouter);
  theApp.use('/api/img', imageRouter);
  theApp.use('/api/stream', streamingRouter);
  theApp.use('/api/admin', adminRouter);

  theApp.get('/api/status', async (req, res) => {
    noCache(res);

    if (!hostIps) {
      hostIps = await new Promise<string[]>((resolve, reject) => {
        new Resolver().resolve(process.env.VS_REQUIRED_HOST || 'shetline.org', (err, result) => {
          if (err)
            reject(err);
          else
            resolve(result);
        });
      });
    }

    const remote = getRemoteAddress(req);
    const status = getStatus(remote);

    jsonOrJsonp(req, res, status);
  });

  theApp.get('/api/download', async (req, res) => {
    const url = (req.query.url as string) || '';
    const filePath = paths.join(/\.mkv$/.test(url) ? process.env.VS_VIDEO_SOURCE : process.env.VS_STREAMING_SOURCE, url);

    if (await existsAsync(filePath)) {
      const fileName = paths.basename(url);
      const legacyName = makePlainASCII(fileName, true);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition',
        `attachment; filename=${legacyName}; filename*=UTF-8''${encodeForUri(fileName)}`);
      res.sendFile(filePath);
    }
    else
      res.sendStatus(404);
  });

  function findUriByAggregationId(agId: number, item?: LibraryItem): string {
    if (!item)
      item = { aggregationId: -1, data: cachedLibrary.array } as LibraryItem;

    if (isFile(item) && item.aggregationId === agId)
      return item.uri;
    else if (item.data) {
      for (const child of item.data) {
        const match = findUriByAggregationId(agId, child);

        if (match)
          return match;
      }
    }

    return null;
  }

  theApp.get('/api/stream-check', async (req, res) => {
    noCache(res);

    const demo = isDemo(req);
    const mobile = toBoolean(req.query.mobile);
    let uri = req.query.uri as string;
    let streamUri: string;
    let video: LibraryItem;
    let result: string = null;

    if (!uri) {
      video = findVideo(toInt(req.query.id));

      if (mobile && video?.mobileUri)
        uri = streamUri = video.mobileUri;
      else if (video?.uri) {
        uri = video.uri;
        streamUri = video.streamUri;
      }
    }

    if (streamUri)
      result = streamUri;
    else if (uri) {
      const streamUriBase = toStreamPath(uri);
      const extensions = demo ? ['.sample.mp4'] : mobile ? ['.mobile.mp4'] : ['.mpd', '.av.webm'];

      outer:
      for (const ext of extensions) {
        const streamUri = streamUriBase + ext;

        if (await existsAsync(paths.join(process.env.VS_STREAMING_SOURCE, streamUri))) {
          result = streamUri;

          if (video && !demo)
            video.streamUri = streamUri;

          continue;
        }

        let altUri = streamUri.replace(/([/\\])([^/\\]+$)/, '$1\x32K$1$2');

        if (await existsAsync(paths.join(process.env.VS_STREAMING_SOURCE, altUri))) {
          result = altUri;

          if (video && !demo)
            video.streamUri = altUri;

          continue;
        }

        const $ = /^(.+)\(\d*_([^)]*)\b(4K|3D)\)(.*)/.exec(streamUri);

        if ($) {
          for (const alt of ['2K', '2D']) {
            for (let i = 0; i < 10; ++i) {
              altUri = `${$[1]}(${i === 0 ? '' : i}_${$[2]}${alt})${$[4]}`;

              if (await existsAsync(paths.join(process.env.VS_STREAMING_SOURCE, altUri))) {
                result = altUri;

                if (video && !demo)
                  video.streamUri = altUri;

                continue outer;
              }
            }
          }
        }
      }
    }

    jsonOrJsonp(req, res, result);
  });

  theApp.get('/api/players', async (req, res) => {
    noCache(res);

    if (!isAdmin(req))
      res.json(['Room 1', 'Room 2', 'Room 3']);
    else if (!process.env.VS_PLAYERS)
      res.json([]);
    else
      res.json(process.env.VS_PLAYERS.split('#').filter((_s, i) => i % 2 === 1));
  });

  function getHost(req: Request): string {
    let host = process.env.VS_ZIDOO_CONNECT;

    if (req.query.player != null && process.env.VS_PLAYERS) {
      const players = process.env.VS_PLAYERS.split('#').filter((_s, i) => i % 2 === 0);

      host = players[toInt(req.query.player)] || host;
    }

    return host;
  }

  async function getPlayStatus(host: string): Promise<PlayStatus> {
    const url = `${host}ZidooVideoPlay/getPlayStatus`;
    const start = processMillis();

    try {
      let status: PlayStatus;

      for (let i = 0; i < 3 && processMillis() < start + 30000; ++i) {
        status = await requestJson(url);

        if (status.status !== 804) // Strange 'bad URL' error condition, even though the URL is fine and will work if tried again
          break;

        await sleep(100);
      }

      return status;
    }
    catch {}

    return null;
  }

  theApp.get('/api/play', async (req, res) => {
    noCache(res);

    if (!isAdmin(req))
      res.sendStatus(403);
    else {
      const host = getHost(req);
      const mainPlayer = (req.query.player == null || toInt(req.query.player) === 0);
      const id = toInt(req.query.id);
      let uri = req.query.uri as string;

      if (uri && !uri.startsWith('/'))
        uri = '/' + uri;
      else if (!uri && id)
        uri = findUriByAggregationId(id);

      const status = await getPlayStatus(host);

      if (uri) {
        uri = process.env.VS_ZIDOO_SOURCE_ROOT + uri;

        if (status?.video?.path === uri) {
          res.json({ alreadyPlaying: true });
          return;
        }
      }

      if (status?.status === 200 && status.video?.path) {
        await requestJson(`${host}ZidooControlCenter/RemoteControl/sendkey?key=Key.MediaStop`);
        await sleep(500);
      }

      if (mainPlayer || uri) {
        const url = mainPlayer && id ?
          `${host}ZidooPoster/PlayVideo?id=${id}&type=0` :
          `${host}ZidooFileControl/openFile?videoplaymode=0&path=${encodeForUri(uri)}`;

        try {
          res.send(await requestText(url));
        }
        catch {
          res.sendStatus(404);
        }
      }
      else
        res.sendStatus(404);
    }
  });

  theApp.get('/api/setTracks', async (req, res) => {
    noCache(res);

    if (!isAdmin(req)) {
      res.sendStatus(403);
      return;
    }

    const host = getHost(req);
    const start = processMillis();
    let ready = false;
    let status: PlayStatus;

    for (let i = 0; i < 100 && processMillis() < start + 30000; ++i) {
      status = await getPlayStatus(host);

      if (status?.status === 200 && status?.video?.path) {
        ready = true;
        break;
      }

      await sleep(500);
    }

    if (!ready) {
      res.sendStatus(424);
      return;
    }

    // Are we close to the playback position that means the player is likely to present
    // a restart/continue dialog that will block track choices from being made?
    if (!toBoolean(req.query.ignorePlaying, false, true) && status?.video?.currentPosition > 58000) {
      res.json({ inProgress: true });
      return;
    }

    const audioIndex = toInt(req.query.audio, -1);
    const subtitleIndex = toInt(req.query.subtitle, -1);
    let url: string;
    let response = '';

    if (audioIndex >= 0) {
      url = `${host}ZidooVideoPlay/setAudio?index=${audioIndex}`;

      try {
        response = await requestText(url);

        if (subtitleIndex >= 0)
          await sleep(250);
      }
      catch {
        res.sendStatus(404);
        return;
      }
    }

    if (subtitleIndex >= 0) {
      url = `${host}ZidooVideoPlay/setSubtitle?index=${subtitleIndex}`;

      try {
        response = await requestText(url);
      }
      catch {
        res.sendStatus(404);
        return;
      }
    }

    res.send(response);
  });

  // Unmatched routes
  theApp.use((req, res) => {
    const token = (req.cookies as NodeJS.Dict<string>).vs_jwt;

    jwt.verify(token, process.env.VS_TOKEN_SECRET as string, (err: any) => {
      if (!err)
        res.sendStatus(401);
      else {
        const ip = getIp(req);
        let block = blockedIps.get(ip);

        if (block == null)
          blockedIps.set(ip, -1);
        else if (block < 0) {
          --block;

          if (block <= -BAD_REQUEST_COUNT) {
            console.log(timeStamp(), 'Blocking:', ip);
            blockedIps.set(ip, processMillis());
          }
          else
            blockedIps.set(ip, block);
        }

        res.sendStatus(403);
      }
    });
  });

  return theApp;
}
