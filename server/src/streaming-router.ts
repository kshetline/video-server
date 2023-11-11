import { Router } from 'express';
import paths from 'path';
import { existsAsync, role } from './vs-util';

export const router = Router();

router.get('/*', async (req, res) => {
  const filePath = paths.join(process.env.VS_STREAMING_SOURCE,
    req.url.substring(1).split('/').map(s => decodeURIComponent(s)).join('/'));

  if (role(req) === 'demo' && !filePath.endsWith('.sample.mp4')) {
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
