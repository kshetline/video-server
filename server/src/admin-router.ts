import { Request, Response, Router } from 'express';
import { existsAsync, isAdmin, jsonOrJsonp, noCache, safeLstat, webSocketSend } from './vs-util';
import { updateLibrary } from './library-router';
import { clone, forEach, isFunction, isNumber, isObject, isString, last, toBoolean } from '@tubular/util';
import { readdir } from 'fs/promises';
import { getValue, setValue } from './settings';
import { join as pathJoin, sep } from 'path';
import { monitorProcess } from './process-util';
import { spawn } from 'child_process';
import { AudioTrack, MediaWrapper, MKVInfo, SubtitlesTrack, VideoStats, VideoTrack, VideoWalkOptions, VideoWalkOptionsPlus } from './shared-types';
import { comparator, sorter } from './shared-utils';
import { examineAndUpdateMkvFlags } from './mkv-flags';
import { sendStatus } from './app';
import { createStreaming } from './streaming';

export const router = Router();
export let adminProcessing = false;

const DEFAULT_VW_OPTIONS: VideoWalkOptions = {
  checkStreaming: true,
  directoryExclude: (_path: string, dir: string, depth: number): boolean => {
    return depth === 0 && dir === 'Home movies';
  },
  isStreamingResource: (file: string): boolean => {
    return /\.(mp4|mpd|webm)$/.test(file);
  }
};

export interface VideoWalkInfo {
  audio?: AudioTrack[];
  error?: string;
  isExtra?: boolean;
  isMovie?: boolean;
  isTV?: boolean;
  mkvInfo?: MKVInfo;
  skip?: boolean;
  streamingDirectory?: string;
  subtitles?: SubtitlesTrack[];
  video?: VideoTrack[];
  videoDirectory?: string;
  wasModified?: boolean;
}

export type VideoWalkCallback = (path: string, depth: number, options?: VideoWalkOptionsPlus,
  info?: VideoWalkInfo) => Promise<void>;

function terminateDir(d: string): string {
  return d + (d.endsWith(sep) ? '' : sep);
}

// export async function walkVideoDirectory(callback: VideoWalkCallback): Promise<VideoStats>;
export async function walkVideoDirectory(options: VideoWalkOptions, callback: VideoWalkCallback): Promise<VideoStats>;
// export async function walkVideoDirectory(dir: string, callback: VideoWalkCallback): Promise<VideoStats>;
// export async function walkVideoDirectory(dir: string, options: VideoWalkOptions, callback: VideoWalkCallback): Promise<VideoStats>;
export async function walkVideoDirectory(
  arg0: string | VideoWalkOptions | VideoWalkCallback,
  arg1?: VideoWalkOptions | VideoWalkCallback,
  arg2?: VideoWalkCallback): Promise<VideoStats> {
  let dir = getValue('videoDirectory');
  let options: VideoWalkOptions = DEFAULT_VW_OPTIONS;
  let callback: VideoWalkCallback;

  if (isFunction(arg0))
    callback = arg0;
  else if (isObject(arg0))
    options = arg0;
  else if (isString(arg0))
    dir = arg0;

  if (!callback && isFunction(arg1))
    callback = arg1;
  else if (!callback && isObject(arg1))
    options = arg1 as VideoWalkOptions;

  if (!callback)
    if (arg2)
      callback = arg2;
    else
      throw new Error('callback required');

  options = Object.assign(clone(DEFAULT_VW_OPTIONS), options);

  (options as VideoWalkOptionsPlus).streamingDirectory = terminateDir(getValue('streamingDirectory'));
  (options as VideoWalkOptionsPlus).videoDirectory = terminateDir(getValue('videoDirectory'));

  if (options.checkStreaming === true)
    options.checkStreaming = getValue('videoDirectory') + '\t' + getValue('streamingDirectory');

  return await walkVideoDirectoryAux(dir, 0, options, callback);
}

async function walkVideoDirectoryAux(dir: string, depth: number, options: VideoWalkOptionsPlus,
                                     callback: VideoWalkCallback, dontRecurse = false): Promise<VideoStats> {
  const stats: VideoStats = {
    errorCount: 0,
    extrasBytes: 0,
    extrasCount: 0,
    miscFileBytes: 0,
    miscFileCount: 0,
    movieBytes: 0,
    movieCountRaw: 0,
    movieTitles: new Set(),
    skippedForAge: 0,
    skippedForType: 0,
    streamingFileBytes: 0,
    streamingFileCount: 0,
    tvBytes: 0,
    tvEpisodesRaw: 0,
    tvEpisodeTitles: new Set(),
    tvShowTitles: new Set(),
    unstreamedTitles: new Set(),
    videoCount: 0,
  };

  const files = (await readdir(dir)).sort(comparator);

  for (const file of files) {
    const path = pathJoin(dir, file);
    const stat = await safeLstat(path);

    if (!stat || file.startsWith('.') || file.endsWith('~') || file.endsWith('~.mkv') || stat.isSymbolicLink()) {
      // Do nothing
    }
    else if (stat.isDirectory()) {
      if (dontRecurse || options.directoryExclude && options.directoryExclude(path, file, depth))
        continue;

      const consolidateStats = (subStats: VideoStats): void => forEach(stats as any, (key, value) => {
        if (isNumber(value))
          (stats as any)[key] += (subStats as any)[key];
        else
          ((subStats as any)[key] as Set<string>).forEach(s => ((stats as any)[key] as Set<string>).add(s));
      });
      const subStats = await walkVideoDirectoryAux(path, depth + 1, options, callback);

      consolidateStats(subStats);

      if (isString(options.checkStreaming)) {
        const baseDirs = options.checkStreaming.split('\t');
        const streamingDir = pathJoin(baseDirs[1], path.substring(baseDirs[0].length));

        if (await existsAsync(streamingDir)) {
          const subStats = await walkVideoDirectoryAux(streamingDir, depth + 1, options, callback, true);

          consolidateStats(subStats);
        }
      }
    }
    else if (/\.tmp\./.test(file)) {
      // Do nothing
    }
    else if (options.isStreamingResource && options.isStreamingResource(file)) {
      stats.streamingFileBytes += stat.size;
      ++stats.streamingFileCount;

      if (options.reportStreamingToCallback)
        await callback(path, depth);
    }
    else if (/\.mkv$/.test(file)) {
      ++stats.videoCount;

      const info: VideoWalkInfo = {};

      if (/[\\/](-Extras-|.*Bonus Disc.*)[\\/]/i.test(path)) {
        info.isExtra = true;
        stats.extrasBytes += stat.size;
        ++stats.extrasCount;
      }
      else if (/§/.test(path) && !/[\\/]Movies[\\/]/.test(path) || /- S\d\dE\d\d -/.test(file)) {
        info.isTV = true;
        stats.tvBytes += stat.size;
        ++stats.tvEpisodesRaw;
      }
      else {
        info.isMovie = true;
        stats.movieBytes += stat.size;
        ++stats.movieCountRaw;
      }

      if (info.isExtra && options.skipExtras || info.isMovie && options.skipMovies || info.isTV && options.skipTV) {
        ++stats.skippedForType;
        info.skip = true;
      }
      else if (options.earliest && +stat.mtime < +options.earliest) {
        ++stats.skippedForAge;
        info.skip = true;
      }

      try {
        if (options.getMetadata && !info.skip) {
          const mkvJson = (await monitorProcess(spawn('mkvmerge', ['-J', path])))
          // uid values exceed available numeric precision. Turn into strings instead.
            .replace(/("uid":\s+)(\d+)/g, '$1"$2"');

          info.mkvInfo = JSON.parse(mkvJson) as MKVInfo;
          info.video = info.mkvInfo.tracks.filter(t => t.type === 'video') as VideoTrack[];
          info.audio = info.mkvInfo.tracks.filter(t => t.type === 'audio') as AudioTrack[];
          info.subtitles = info.mkvInfo.tracks.filter(t => t.type === 'subtitles') as SubtitlesTrack[];

          const mediaJson = await monitorProcess(spawn('mediainfo', [path, '--Output=JSON']));
          const mediaTracks = (JSON.parse(mediaJson || '{}') as MediaWrapper).media?.track || [];
          const typeIndices = {} as Record<string, number>;

          for (const track of mediaTracks) {
            const type = track['@type'].toLowerCase();
            const index = (typeIndices[type] ?? -1) + 1;
            const mkvSet = (type === 'video' ? info.video : type === 'audio' ? info.audio : []);

            typeIndices[type] = index;

            if (mkvSet[index]?.properties)
              mkvSet[index].properties.media = track;
          }
        }

        const baseTitle = file.replace(/( ~)?\.mkv$/i, '');

        if (info.isMovie || info.isTV) {
          let title = baseTitle.replace(/\s*\(.*?[a-z].*?\)/gi, '').replace(/^\d{1,2} - /, '').replace(/ - /g, ': ')
            .replace(/：/g, ':').replace(/？/g, '?').trim().replace(/(.+), (A|An|The)$/, '$2 $1');

          if (info.isMovie) {
            title = title.replace(/-S\d\dE\d\d-|-M\d-/, ': ');
            (stats.movieTitles as Set<string>).add(title);
          }
          else {
            (stats.tvEpisodeTitles as Set<string>).add(title);

            let $: RegExpExecArray;
            let seriesTitle = last(path.replace(/^\w:/, '').split(/[/\\]/).filter(s => s.includes('§')).map(s => s.trim()
              .replace(/^\d+\s*-\s*/, '')
              .replace(/§.*$/, '')
              .replace(/\s+-\s+\d\d\s+-\s+/, ': ')
              .replace(/\s+-\s+/, ': ')
              .replace(/\s*\(.*?[a-z].*?\)/gi, '').trim()
              .replace(/(.+), (A|An|The)$/, '$2 $1')));

            if (!seriesTitle && ($ = /(.*?): S\d\dE\d\d:/.exec(title)))
              seriesTitle = $[1];

            if (seriesTitle)
              (stats.tvShowTitles as Set<string>).add(seriesTitle);
          }
        }

        if (options.checkStreaming && !dontRecurse) {
          let title = baseTitle.replace(/\s*\([234][DK]\)/gi, '').replace(/#/g, '_');

          if (!/[-_(](4K|3D)\)/.test(title)) {
            const sDir = pathJoin(options.streamingDirectory, dir.substring(options.videoDirectory.length));
            const stream1 = pathJoin(sDir, title + '.mpd');
            const stream2 = pathJoin(sDir, title + '.av.webm');
            const stream3 = pathJoin(sDir, '2K', title + '.mpd');
            const stream4 = pathJoin(sDir, '2K', title + '.av.webm');

            if (!await existsAsync(stream1) && !await existsAsync(stream2) && !await existsAsync(stream3) && !await existsAsync(stream4)) {
              title = title.replace(/\s*\((\d*)#([-_.a-z0-9]+)\)/i, '');
              (stats.unstreamedTitles as Set<string>).add(title);
            }
          }
        }

        info.streamingDirectory = options.streamingDirectory;
        info.videoDirectory = options.videoDirectory;
        await callback(path, depth, options, info);
      }
      catch (e) {
        console.error('Error while processing %s:', path, e);
      }
    }
    else {
      stats.miscFileBytes += stat.size;
      ++stats.miscFileCount;
    }
  }

  return stats;
}

router.post('/library-refresh', async (req: Request, res: Response) => {
  if (!isAdmin(req))
    res.sendStatus(403);
  else {
    if (!adminProcessing) {
      adminProcessing = true;
      sendStatus();
      updateLibrary(toBoolean(req.query.quick)).finally(() => {
        adminProcessing = false;
        sendStatus();
      });
    }

    res.json(!adminProcessing);
  }
});

export let statsInProgress = false;

interface UpdateOptions {
  canModify?: boolean;
  checkStreaming?: boolean;
  earliest?: Date;
  generateStreaming?: boolean;
  mkvFlags?: boolean;
  skipExtras?: boolean;
  skipMovies?: boolean;
  skipTV?: boolean;
  stats?: boolean;
}

async function videoWalk(options: UpdateOptions): Promise<VideoStats> {
  let stats: any = null;

  if (!statsInProgress && !adminProcessing && (options.stats || options.mkvFlags || options.generateStreaming)) {
    statsInProgress = true;
    adminProcessing = true;
    sendStatus();

    await (async (): Promise<void> => {
      try {
        let lastChar = '';
        stats = await walkVideoDirectory({
          canModify: options.canModify,
          checkStreaming: options.checkStreaming,
          earliest: options.earliest,
          getMetadata: options.mkvFlags || options.generateStreaming,
          mkvFlags: options.mkvFlags,
          generateStreaming: options.generateStreaming
        },
          async (path: string, depth: number, options: VideoWalkOptionsPlus, info: VideoWalkInfo): Promise<void> => {
            const startChar = path.charAt(info.videoDirectory.length);

            if (depth === 1 && lastChar !== startChar) {
              lastChar = startChar;
              webSocketSend({ type: 'videoStatsProgress', data: startChar });
            }

            if (info.skip)
              return;

            webSocketSend({ type: 'currentFile', data: path.substring(info.videoDirectory.length) });

            if (options.mkvFlags)
              await examineAndUpdateMkvFlags(path, options, info);

            if (options.generateStreaming)
              await createStreaming(path, options, info);
          });
        const statsStr = JSON.stringify(stats, (_key, value) => {
          if (value instanceof Set)
            return Array.from(value.values()).sort(sorter);
          else
            return value;
        }, 2);

        setValue('videoStats', statsStr);
        webSocketSend({ type: 'videoStats', data: statsStr });
      }
      catch (e) {
        console.error('Error compiling video stats');
        console.error(e);
      }
      finally {
        statsInProgress = false;
        sendStatus();
      }
    })();
  }

  return stats;
}

router.get('/stats', async (req, res) => {
  noCache(res);

  const statsStr = getValue('videoStats');
  let stats: any = null;

  try {
    stats = statsStr ? JSON.parse(statsStr) : null;
  }
  catch {}

  if (!statsInProgress && !adminProcessing && toBoolean(req.query.update)) {
    videoWalk({ checkStreaming: true, stats: true }).finally(() => {
      adminProcessing = false;
      sendStatus();
    });
  }

  jsonOrJsonp(req, res, stats);
});

router.post('/process', async (req, res) => {
  noCache(res);

  if (!adminProcessing) {
    const mkvFlags = toBoolean(req.body.mkvFlags, null, true);
    const generateStreaming = toBoolean(req.body.generateStreaming, null, true);
    const canModify = mkvFlags || generateStreaming;
    const options: UpdateOptions = {
      canModify,
      checkStreaming: generateStreaming,
      earliest: req.body.earliest ? new Date(req.body.earliest) : undefined,
      generateStreaming,
      mkvFlags,
      skipExtras: toBoolean(req.body.skipExtras, null, true),
      skipMovies: toBoolean(req.body.skipMovies, null, true),
      skipTV: toBoolean(req.body.skipTV, null, true),
    };

    sendStatus();
    videoWalk(options).finally(() => {
      adminProcessing = false;
      sendStatus();
    });
    res.send('OK');
  }
  else
    res.send('Busy');
});
