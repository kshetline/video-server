import { Request, Response, Router } from 'express';
import paths from 'path';
import { cacheDir, deleteIfPossible, existsAsync, safeLstat, thumbnailDir, touch } from './vs-util';
import { requestBinary } from 'by-request';
import { checksum53, isValidJson, regexEscape, toInt } from '@tubular/util';
import { readdir, writeFile } from 'fs/promises';
// eslint-disable-next-line n/no-extraneous-import
import Jimp from 'jimp';

export const router = Router();

/* cspell:disable-next-line */ // noinspection SpellCheckingInspection
const TRANSPARENT_PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64');
const vSource = process.env.VS_VIDEO_SOURCE;
const profileRoot = 'http://image.tmdb.org/t/p/original';

async function getImage(imageType: string, apiPath: string, req: Request, res: Response): Promise<void> {
  const uri = (req.query.uri as string)?.replace(/^\//, '');
  const id = req.query.id;
  const profile = (imageType === 'profile');
  let id2 = req.query.id2;
  let fullSize: Buffer;
  let imagePath: string;
  let newFile = false;
  let profileName: string;
  let profileExt: string;
  let isJson = false;

  function sendImageError(buf: Buffer): void {
    const msg = JSON.parse(buf.toString());

    res.statusCode = msg.status;
    res.setHeader('Content-Type', 'text/plain');
    res.send(msg.msg);
  }

  for (let i = 0; i < 2; ++i) {
    if (uri) {
      if (profile) {
        imagePath = paths.join(cacheDir, imageType, uri);
        profileName = uri.replace(/\.\w+$/, '');
        profileExt = uri.substring(profileName.length);
      }
      else
        imagePath = paths.join(vSource, uri);
    }
    else
      imagePath = paths.join(cacheDir, imageType, `${id}${id2 ? '-' + id2 : ''}-${req.query.cs || 'x'}.jpg`);

    const stat = await safeLstat(imagePath);

    if (id2 && stat?.size === 0) {
      id2 = undefined;
      continue;
    }

    if (!stat && (!uri || profile)) {
      const url = profile ? `${profileRoot}/${uri}` :
        `${process.env.VS_ZIDOO_CONNECT}${apiPath}?id=${id2 || id}`;

      try {
        fullSize = await requestBinary(url);
      }
      catch {
        fullSize = TRANSPARENT_PIXEL;
      }

      isJson = (fullSize.length < 200 && isValidJson(fullSize.toString()));

      if (isJson) {
        if (id2) {
          newFile = true;
          await writeFile(imagePath, '', 'binary');
          id2 = undefined;
          continue;
        }
        else if (imageType === 'backdrop')
          fullSize = TRANSPARENT_PIXEL;
        else {
          sendImageError(fullSize);
          return;
        }
      }

      newFile = true;
      await writeFile(imagePath, fullSize, 'binary');
      break;
    }
  }

  if (!req.query.w || !req.query.h) {
    if (!newFile)
      touch(imagePath, false).finally(); // Track recency of cache usage

    res.sendFile(imagePath);
    return;
  }

  const thumbnailPath = profile ?
    paths.join(thumbnailDir, imageType, `${profileName}-${req.query.w}-${req.query.h}${profileExt}`) :
    uri ?
      paths.join(thumbnailDir, imageType, `${checksum53(uri)}-${req.query.w}-${req.query.h}.jpg`) :
      paths.join(thumbnailDir, imageType, `${req.query.id}-${req.query.cs}-${req.query.w}-${req.query.h}.jpg`);

  if (!await existsAsync(thumbnailPath)) {
    if (isJson)
      sendImageError(fullSize);
    else
      Jimp.read((fullSize || imagePath) as any).then(image =>
        image.resize(toInt(req.query.w), toInt(req.query.h)).quality(80).write(thumbnailPath,
          () => res.sendFile(thumbnailPath)));
  }
  else {
    touch(thumbnailPath, false).finally(); // Track recency of cache usage
    res.sendFile(thumbnailPath);
  }
}

router.get('/poster', async (req, res) => {
  await getImage('poster', 'Poster/v2/getPoster', req, res);
});

router.get('/backdrop', async (req, res) => {
  await getImage('backdrop', 'Poster/v2/getBackdrop', req, res);
});

router.get('/profile', async (req, res) => {
  await getImage('profile', profileRoot, req, res);
});

router.get('/logo', async (req, res) => {
  const url = ((req.query.url as string) || '').normalize();
  const ext = (/(\.\w+)$/.exec(url) ?? [])[1] || '.png';
  const cs = checksum53(url);
  const imagePath = paths.join(cacheDir, 'logo', `${cs}${ext}`);

  if (!await existsAsync(imagePath))
    await writeFile(imagePath, await requestBinary(url), 'binary');
  else
    touch(imagePath, false).finally(); // Track recency of cache usage

  res.sendFile(imagePath);
});

router.post('/refresh', async (req, res) => {
  const type = req.query.type?.toString();
  const file = req.query.file?.toString();
  const imagePath = paths.join(cacheDir, type, file);
  const size = (await safeLstat(imagePath))?.size;

  await deleteIfPossible(imagePath);

  if (size === 0) {
    const altPath = imagePath.replace(/^(.+[\\/]\d+-)(\d+-)(.+)$/, '$1$3');

    if (altPath !== imagePath)
      await deleteIfPossible(altPath);
  }

  if (type === 'poster') {
    const thumbnails = await readdir(paths.join(thumbnailDir, type));
    const match = new RegExp('^' + regexEscape(file.slice(0, -4)) + '-\\d+-\\d+\\.jpg$');

    for (const thumbnail of thumbnails) {
      if (match.test(thumbnail))
        await deleteIfPossible(paths.join(thumbnailDir, type, thumbnail));
    }
  }

  res.status(200).send();
});
