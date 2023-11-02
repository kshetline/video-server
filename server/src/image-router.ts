import { Request, Response, Router } from 'express';
import paths from 'path';
import { cacheDir, checksum53, deleteIfPossible, escapeForRegex, existsAsync, safeLstat, thumbnailDir } from './vs-util';
import { requestBinary } from 'by-request';
import { isValidJson, toInt } from '@tubular/util';
import { readdir, writeFile } from 'fs/promises';
import Jimp from 'jimp';

export const router = Router();

/* cspell:disable-next-line */ // noinspection SpellCheckingInspection
const TRANSPARENT_PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64');

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

router.get('/poster', async (req, res) => {
  await getImage('poster', 'Poster/v2/getPoster', req, res);
});

router.get('/backdrop', async (req, res) => {
  await getImage('backdrop', 'Poster/v2/getBackdrop', req, res);
});

router.get('/logo', async (req, res) => {
  const url = (req.query.url as string) || '';
  const ext = (/(\.\w+)$/.exec(url) ?? [])[1] || '.png';
  const cs = checksum53(url);
  const imagePath = paths.join(cacheDir, 'logo', `${cs}${ext}`);

  if (!await existsAsync(imagePath))
    await writeFile(imagePath, await requestBinary(url), 'binary');

  res.sendFile(imagePath);
});

router.post('/refresh', async (req, res) => {
  const type = req.query.type?.toString();
  const file = req.query.file?.toString();
  const imagePath = paths.join(cacheDir, type, file);
  const size = (await safeLstat(imagePath))?.size;

  await deleteIfPossible(imagePath);

  if (size === 0) {
    const altPath = imagePath.replace(/^(.+\/\d+-)(\d+-)(.+)$/, '$1$3');

    if (altPath !== imagePath)
      await deleteIfPossible(altPath);
  }

  if (type === 'poster') {
    const thumbnails = await readdir(paths.join(thumbnailDir, type));
    const match = new RegExp('^' + escapeForRegex(file.slice(0, -4)) + '-\\d+-\\d+\\.jpg$');

    for (const thumbnail of thumbnails) {
      if (match.test(thumbnail))
        await deleteIfPossible(thumbnail);
    }
  }

  res.status(200).send();
});
