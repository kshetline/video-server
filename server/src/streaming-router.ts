import { Router } from 'express';
import paths from 'path';
import { existsAsync, isDemo, jsonOrJsonp, username, watched, webSocketSend } from './vs-util';
import { LibraryItem, PlaybackProgress } from './shared-types';
import { getDb } from './settings';
import { findId, updateCache } from './library-router';

export const router = Router();

function setWatched(item: LibraryItem, state: boolean): void {
  if (!item)
    return;

  if (item.streamUri) {
    item.watchedByUser = state;

    if (state)
      item.lastPlayTime = -1;
  }

  if (item.data)
    item.data.forEach(i => setWatched(i, state));
}

router.put('/progress', async (req, res) => {
  try {
    const progress = req.body as PlaybackProgress;
    const db = getDb();
    const wasWatched = progress.watched != null ? progress.watched :
      await watched(progress.offset, progress.duration, progress.hash, username(req));

    await db.run('INSERT OR REPLACE INTO watched (user, video, duration, offset, watched, last_watched) \
      VALUES (?, ?, ?, ?, ?, ?)',
      username(req), progress.hash, progress.duration, progress.offset, wasWatched ? 1 : 0, Date.now());

    if (progress.id) {
      let id = progress.id;
      const match = findId(id);

      if (match) {
        let item = match;

        while (item.parentId > 0) {
          const parent = findId(item.parentId);

          if (parent) {
            item = parent;
            id = parent.id;
          }
          else
            break;
        }

        setWatched(match, wasWatched);
        updateCache(match.id).finally();
      }

      webSocketSend({ type: 'idUpdate', data: id });
    }

    res.sendStatus(200);
  }
  catch {
    res.sendStatus(500);
  }
});

router.get('/progress', async (req, res) => {
  try {
    const db = getDb();
    const videos = req.query.videos.toString().split(',');
    const placeholders = Array(videos.length).fill('?').join(',');
    const response = (await db.all(
      `SELECT video, duration, offset, watched FROM watched WHERE user = ? AND video IN (${placeholders})`,
      username(req), ...videos)).map((row: any) =>
      ({ hash: row.video, duration: row.duration, offset: row.offset,
         watched: !!row.watched, last_watched: row.last_watched } as PlaybackProgress));

    jsonOrJsonp(req, res, response);
  }
  catch {
    res.sendStatus(500);
  }
});

router.get('/*', async (req, res) => {
  const filePath = paths.join(process.env.VS_STREAMING_SOURCE,
    req.url.substring(1).split('/').map(s => decodeURIComponent(s)).join('/')).normalize();

  if (isDemo(req) && !filePath.endsWith('.sample.mp4')) {
    res.sendStatus(403);
    return;
  }

  if (await existsAsync(filePath)) {
    if (filePath.endsWith('.audio.webm'))
      res.setHeader('Content-Type', 'audio/webm');
    else if (filePath.endsWith('.webm'))
      res.setHeader('Content-Type', 'video/webm');
    else if (filePath.endsWith('.mpd'))
      res.setHeader('Content-Type', 'application/dash+xml');

    res.sendFile(filePath);
  }
  else
    res.sendStatus(404);
});
