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
import * as https from 'https';
import { asLines, encodeForUri, isString, makePlainASCII, toBoolean, toInt } from '@tubular/util';
import logger from 'morgan';
import * as paths from 'path';
import { existsAsync, jsonOrJsonp, noCache, normalizePort, role, timeStamp } from './vs-util';
import fs from 'fs';
import { cachedLibrary, initLibrary, pendingLibrary, router as libraryRouter, updateLibrary } from './library-router';
import { router as imageRouter } from './image-router';
import { router as streamingRouter } from './streaming-router';
import { LibraryItem, LibraryStatus, ServerStatus, User, UserSession, VType } from './shared-types';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const debug = require('debug')('express:server');

const REQUIRED_HOST = process.env.VS_REQUIRED_HOST;

// Create HTTP server
const devMode = process.argv.includes('-d');
const allowCors = toBoolean(process.env.VS_ALLOW_CORS) || devMode;
const defaultPort = devMode ? 4201 : 8080;
const httpPort = normalizePort(process.env.VS_PORT || defaultPort);
const insecurePort = normalizePort(process.env.VS_INSECURE_PORT);
const useHttps = toBoolean(process.env.VS_USE_HTTPS);
const app = getApp();
let httpServer: http.Server | https.Server;
let insecureServer: http.Server;
const MAX_START_ATTEMPTS = 3;
let startAttempts = 0;
let users: User[] = [];

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGUSR2', shutdown);
process.on('unhandledRejection', err => console.error(`${timeStamp()} -- Unhandled rejection:`, err));

createAndStartServer();

function createAndStartServer(): void {
  console.log(`*** Starting server on port ${httpPort} at ${timeStamp()} ***`);

  httpServer = useHttps ? https.createServer({
    key: fs.readFileSync(process.env.VS_KEY),
    cert: fs.readFileSync(process.env.VS_CERT)
  }, app) :
    http.createServer(app);
  httpServer.on('error', onError);
  httpServer.on('listening', onListening);

  users = JSON.parse(fs.readFileSync('users.json').toString('utf8'));
  initLibrary();

  httpServer.listen(httpPort);

  if (useHttps && insecurePort) {
    insecureServer = http.createServer(app);
    insecureServer.on('error', onError);
    insecureServer.on('listening', onListening);
    insecureServer.listen(insecurePort);
  }
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

  // Make sure that if the orderly clean-up gets stuck, shutdown still happens.
  if (insecureServer)
    insecureServer.close();

  httpServer.close(() => process.exit(0));
}

function getApp(): Express {
  const theApp = express();

  theApp.use(logger('[:date[iso]] :remote-addr - :remote-user ":method :url HTTP/:http-version" :status :res[content-length] :response-time'));
  theApp.use(express.json());
  theApp.use(express.urlencoded({ extended: false }));
  theApp.use(cookieParser());

  //  hashed_password = crypto.pbkdf2Sync("password", salt, 100000, 64, 'sha512').toString('hex')
  theApp.use((req, res, next) => {
    const token = req.cookies.vs_jwt;
    const userInfo = token?.split('.')[1];

    if (!/^\/api\//.test(req.url) || /^\/api\/(login|status)\b/.test(req.url))
      next();
    else if (userInfo == null)
      res.sendStatus(401);
    else {
      jwt.verify(token, process.env.VS_TOKEN_SECRET as string, (err: any, user: any) => {
        if (err)
          res.sendStatus(403);
        else {
          user.role = users.find(u => u.name === user.username)?.role;
          (req as any).user = user;
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

  theApp.post('/api/login', async (req, res) => {
    const username = req.body.user?.toString();
    const pwd = req.body.pwd?.toString();

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
            const expiresIn = user.time_to_expire || 3600; // In seconds
            const expiration = Date.now() + expiresIn * 1000;
            const token = jwt.sign({ username }, process.env.VS_TOKEN_SECRET, { expiresIn });
            const session: UserSession = { name: user.name, role: user.role, expiration };

            res.cookie('vs_jwt', token, { secure: useHttps, httpOnly: true, expires: new Date(expiration) });
            res.json(session);

            return;
          }
        }
        catch {}

        break;
      }
    }

    res.status(403).end();
  });

  theApp.use('/api/library', libraryRouter);
  theApp.use('/api/img', imageRouter);
  theApp.use('/api/stream', streamingRouter);

  theApp.get('/api/status', async (req, res) => {
    noCache(res);

    const status: ServerStatus = {
      lastUpdate: cachedLibrary?.lastUpdate,
      ready: cachedLibrary?.status === LibraryStatus.DONE,
      updateProgress: -1
    };

    if (pendingLibrary)
      status.updateProgress = pendingLibrary.progress;

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

  function findVideo(id: number, item?: LibraryItem): LibraryItem {
    if (!item)
      item = { id: -1, data: cachedLibrary.array } as LibraryItem;

    if (item.type === VType.FILE && item.id === id)
      return item;
    else if (item.data) {
      for (const child of item.data) {
        const match = findVideo(id, child);

        if (match)
          return match;
      }
    }

    return null;
  }

  theApp.get('/api/stream-check', async (req, res) => {
    noCache(res);

    const demo = role(req) === 'demo';
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
      const streamUriBase = uri.replace(/\.mkv$/, '').replace(/\s*\(2[DK]\)$/, '');
      const extensions = demo ? ['.sample.mp4'] : mobile ? ['.mobile.mp4'] : ['.mpd', '.av.webm'];

      for (const ext of extensions) {
        const streamUri = streamUriBase + ext;

        if (await existsAsync(paths.join(process.env.VS_STREAMING_SOURCE, streamUri))) {
          result = streamUri;

          if (video && !demo)
            video.streamUri = streamUri;
        }
      }
    }

    jsonOrJsonp(req, res, result);
  });

  theApp.post('/api/library-refresh', async (req, res) => {
    if (role(req) !== 'admin')
      res.sendStatus(403);
    else {
      updateLibrary().finally();
      res.json(null);
    }
  });

  return theApp;
}
