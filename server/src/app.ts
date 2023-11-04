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
import { asLines, encodeForUri, isString, makePlainASCII, toBoolean } from '@tubular/util';
import logger from 'morgan';
import * as paths from 'path';
import { jsonOrJsonp, noCache, normalizePort, timeStamp } from './vs-util';
import fs from 'fs';
import { cachedLibrary, initLibrary, pendingLibrary, router as libraryRouter } from './library-router';
import { router as imageRouter } from './image-router';
import { LibraryStatus, ServerStatus, User } from './shared-types';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const debug = require('debug')('express:server');

const REQUIRED_HOST = process.env.VS_REQUIRED_HOST;

// Create HTTP server
const devMode = process.argv.includes('-d');
const allowCors = toBoolean(process.env.VS_ALLOW_CORS) || devMode;
const defaultPort = devMode ? 4201 : 8080;
const httpPort = normalizePort(process.env.VS_PORT || defaultPort);
const app = getApp();
let httpServer: http.Server | https.Server;
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
  httpServer = toBoolean(process.env.VC_USE_HTTPS) ? https.createServer({
    key: fs.readFileSync(process.env.VS_KEY),
    cert: fs.readFileSync(process.env.VS_CERT)
  }, app) :
    http.createServer(app);
  httpServer.on('error', onError);
  httpServer.on('listening', onListening);

  users = JSON.parse(fs.readFileSync('users.json').toString('utf8'));
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

  //  hashed_password = crypto.pbkdf2Sync("password", salt, 100000, 64, 'sha512').toString('hex')
  theApp.use((req, res, next) => {
    const token = req.headers.authorization;
    const userInfo = token?.split('.')[1];

    if (req.url === '/api/login' || req.url?.startsWith('/api/img'))
      next();
    else if (userInfo == null)
      res.sendStatus(401);
    else {
      jwt.verify(token, process.env.VS_TOKEN_SECRET as string, (err: any, user: any) => {
        if (err)
          res.sendStatus(403);
        else {
          (req as any).user = user;
          next();
        }
      });
    }
  });

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
            res.json(jwt.sign({ username }, process.env.VS_TOKEN_SECRET, { expiresIn: 86400 }));
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
