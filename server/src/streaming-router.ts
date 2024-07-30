import { Router } from 'express';
import paths from 'path';
import { existsAsync, isDemo, jsonOrJsonp, username, watched, webSocketSend } from './vs-util';
import { LibraryItem, PlaybackProgress } from './shared-types';
import { getDb } from './settings';
import { findId } from './library-router';
import { hashUri, isFile } from './shared-utils';

export const router = Router();

function setWatched(item: LibraryItem, state: boolean): void {
  if (!item)
    return;

  if (item.streamUri) {
    item.watchedByUser = state;
    item.positionUser = state ? 0 : -1;
    item.lastUserWatchTime = state ? Date.now() : -1;
  }

  const parent = item.parent || findId(item.parentId);

  if (parent?.data) {
    parent.data.forEach(sibling => {
      if (sibling !== item && sibling.streamUri === item.streamUri) {
        sibling.watchedByUser = state;
        sibling.positionUser = state ? 0 : -1;
        sibling.lastUserWatchTime = state ? Date.now() : -1;
      }
    });
  }

  if (item.data)
    item.data.forEach(i => setWatched(i, state));
}

async function setWatchedDb(item: LibraryItem, username: string, progress: PlaybackProgress): Promise<boolean> {
  try {
    const db = getDb();
    const wasWatched = progress.watched != null ? progress.watched :
      await watched(progress.offset, progress.duration, progress.hash, username);

    if (!wasWatched && progress.offset === 0)
      await db.run('DELETE FROM watched WHERE user = ? AND video = ?', username, progress.hash);
    else
      await db.run('INSERT OR REPLACE INTO watched (user, video, duration, offset, watched, last_watched) \
        VALUES (?, ?, ?, ?, ?, ?)',
        username, progress.hash, progress.duration, progress.offset, wasWatched ? 1 : 0, Date.now());

    if (item) {
      setWatched(item, wasWatched);
      webSocketSend({ type: 'idUpdate', data: item.id });

      const parent = item.parent || findId(item.parentId);

      if (parent?.data && item.streamUri && isFile(item) &&
          parent.data.reduce((sum, sibling) => sum + (sibling.streamUri === item.streamUri ? 1 : 0), 0) > 1)
        webSocketSend({ type: 'idUpdate', data: parent.id });
    }

    return true;
  }
  catch {}

  return false;
}

async function setWatchedMultiple(item: LibraryItem, username: string, progress: PlaybackProgress): Promise<boolean> {
  if (!item?.data)
    return true;

  let response = true;

  for (const child of item.data) {
    if (isFile(child)) {
      progress.id = child.id;
      progress.hash = hashUri(child.streamUri);
      progress.duration = child.duration;
      progress.last_watched = progress.watched ? Date.now() : progress.last_watched;
      progress.offset = progress.watched ? 0 : progress.offset;
      response = await setWatchedDb(child, username, progress);
    }
    else
      response = await setWatchedMultiple(child, username, progress);

    if (!response)
      return false;
  }

  return response;
}

router.put('/progress', async (req, res) => {
  const progress = req.body as PlaybackProgress;
  const item = progress.id && findId(progress.id);
  let response = false;

  if (item || progress.hash)
    response = !item || isFile(item) ? await setWatchedDb(item, username(req), progress) :
      await setWatchedMultiple(item, username(req), progress);

  res.sendStatus(response ? 200 : 500);
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
