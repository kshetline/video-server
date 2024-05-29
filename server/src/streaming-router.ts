import { Router } from 'express';
import paths from 'path';
import { existsAsync, isDemo, jsonOrJsonp, username, watched } from './vs-util';
import { PlaybackProgress } from './shared-types';
import { getDb } from './settings';

export const router = Router();

router.put('/progress', async (req, res) => {
  try {
    const progress = req.body as PlaybackProgress;
    const db = getDb();
    const wasWatched = await watched(progress.offset, progress.duration, progress.hash, username(req));

    db.run('INSERT OR REPLACE INTO watched (user, video, offset, watched) \
      VALUES (?, ?, ?, ?)', username(req), progress.hash, progress.offset, wasWatched ? 1 : 0).finally();

    res.sendStatus(200);
  }
  catch {
    res.sendStatus(500);
  }
});

router.get('/progress', async (req, res) => {
  try {
    const db = getDb();
    const videos = req.query.videos.toString().replace(/[^,0-9A-Z]/i, '-').split(',');
    const response = (await db.all(`SELECT video, offset, watched FROM watched WHERE user = ? AND video IN ('${videos.join("','")}')`,
      username(req))).map((row: any) => ({ hash: row.video, offset: row.offset, watched: !!row.watched } as PlaybackProgress));

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
