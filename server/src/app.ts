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
import express, { Express, Request, Response } from 'express';
import * as http from 'http';
import * as https from 'https';
import { asLines, encodeForUri, isString, isValidJson, makePlainASCII, toBoolean, toInt } from '@tubular/util';
import logger from 'morgan';
import * as paths from 'path';
import { cacheDir, checksum53, existsAsync, jsonOrJsonp, noCache, normalizePort, safeLstat, thumbnailDir, timeStamp } from './vs-util';
import { requestBinary } from 'by-request';

import { writeFile } from 'fs/promises';
import fs from 'fs';
import Jimp from 'jimp';
import { cachedLibrary, initLibrary, pendingLibrary, router as libraryRouter } from './library-router';
import { LibraryStatus, ServerStatus } from './shared-types';

const debug = require('debug')('express:server');

const REQUIRED_HOST = process.env.VS_REQUIRED_HOST;

/* cspell:disable-next-line */ // noinspection SpellCheckingInspection
const TRANSPARENT_PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64');

// Create HTTP server
const devMode = process.argv.includes('-d');
const allowCors = toBoolean(process.env.VS_ALLOW_CORS) || devMode;
const defaultPort = devMode ? 4201 : 8080;
const httpPort = normalizePort(process.env.VS_PORT || defaultPort);
const app = getApp();
let httpServer: http.Server | https.Server;
const MAX_START_ATTEMPTS = 3;
let startAttempts = 0;

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGUSR2', shutdown);
process.on('unhandledRejection', err => console.error(`${timeStamp()} -- Unhandled rejection:`, err));

createAndStartServer();

function createAndStartServer(): void {
  console.log(`*** Starting server on port ${httpPort} at ${timeStamp()} ***`);
  httpServer = toBoolean(process.env.VC_USE_HTTPS) ? https.createServer({
    key: fs.readFileSync(process.env.VS_KEY),
    cert: fs.readFileSync(process.env.VS_CERT)
  }, app) :
    http.createServer(app);
  httpServer.on('error', onError);
  httpServer.on('listening', onListening);

  initLibrary();

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

  theApp.use((req, res, next) => {
    if (!REQUIRED_HOST || req.hostname === 'localhost' || req.hostname === REQUIRED_HOST)
      next();
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

  theApp.use('/api/library', libraryRouter);

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

  async function getImage(imageType: string, apiPath: string, req: Request, res: Response): Promise<void> {
    const id = req.query.id;
    let id2 = req.query.id2;
    let fullSize: Buffer;
    let imagePath: string;

    for (let i = 0; i < 2; ++i) {
      imagePath = paths.join(cacheDir, imageType, `${id}${id2 ? '-' + id2 : ''}-${req.query.cs || 'x'}.jpg`);

      const stat = await safeLstat(imagePath);

      if (id2 && stat?.size === 0) {
        id2 = undefined;
        continue;
      }

      if (!stat) {
        const url = `${process.env.VS_ZIDOO_CONNECT}${apiPath}?id=${id2 || id}`;

        fullSize = await requestBinary(url);

        if (fullSize.length < 200 && isValidJson(fullSize.toString())) {
          if (id2) {
            await writeFile(imagePath, '', 'binary');
            id2 = undefined;
            continue;
          }
          else if (imageType === 'backdrop')
            fullSize = TRANSPARENT_PIXEL;
          else {
            const msg = JSON.parse(fullSize.toString());

            res.statusCode = msg.status;
            res.setHeader('Content-Type', 'text/plain');
            res.send(msg.msg);
            return;
          }
        }

        await writeFile(imagePath, fullSize, 'binary');
        break;
      }
    }

    if (!req.query.w || !req.query.h) {
      res.sendFile(imagePath);
      return;
    }

    const thumbnailPath = paths.join(thumbnailDir, imageType, `${req.query.id}-${req.query.cs}-${req.query.w}-${req.query.h}.jpg`);

    if (!await existsAsync(thumbnailPath)) {
      Jimp.read((fullSize || imagePath) as any).then(image =>
        image.resize(toInt(req.query.w), toInt(req.query.h)).quality(80).write(thumbnailPath,
          () => res.sendFile(thumbnailPath)));
    }
    else
      res.sendFile(thumbnailPath);
  }

  theApp.get('/api/poster', async (req, res) => {
    await getImage('poster', 'Poster/v2/getPoster', req, res);
  });

  theApp.get('/api/backdrop', async (req, res) => {
    await getImage('backdrop', 'Poster/v2/getBackdrop', req, res);
  });

  theApp.get('/api/logo', async (req, res) => {
    const url = (req.query.url as string) || '';
    const ext = (/(\.\w+)$/.exec(url) ?? [])[1] || '.png';
    const cs = checksum53(url);
    const imagePath = paths.join(cacheDir, 'logo', `${cs}${ext}`);

    if (!await existsAsync(imagePath))
      await writeFile(imagePath, await requestBinary(url), 'binary');

    res.sendFile(imagePath);
  });

  theApp.get('/api/download', async (req, res) => {
    const url = (req.query.url as string) || '';
    const filePath = paths.join(process.env.VS_VIDEO_SOURCE, url);
    const fileName = paths.basename(url);
    const legacyName = makePlainASCII(fileName, true);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition',
      `attachment; filename=${legacyName}; filename*=UTF-8''${encodeForUri(fileName)}`);
    res.sendFile(filePath);
  });

  return theApp;
}
