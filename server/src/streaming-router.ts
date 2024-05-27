import { Router } from 'express';
import paths from 'path';
import { existsAsync, isDemo, username, watched } from './vs-util';
import { PlaybackProgress } from './shared-types';
import { getDb } from './settings';

export const router = Router();

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

router.put('/progress', async (req, res) => {
  const progress = req.body as PlaybackProgress;
  const db = getDb();
  const wasWatched = await watched(progress.time, progress.duration, progress.cs, username(req));

  db.run('INSERT OR REPLACE INTO watched (user, video, offset, watched) \
    VALUES (?, ?, ?, ?)', username(req), progress.cs, progress.time, wasWatched ? 1 : 0).finally();

  res.sendStatus(200);
});
