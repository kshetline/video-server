import { Request, Response, Router } from 'express';
import { DirectoryEntry, fileCountFromEntry, getRemoteRecursiveDirectory, isAdmin, jsonOrJsonp, noCache, pathExists, pathToEntry, webSocketSend } from './vs-util';
import { mappedDurations, updateLibrary } from './library-router';
import { asLines, clone, forEach, isNumber, isString, last, toBoolean, toInt, toNumber } from '@tubular/util';
import { getDb, getAugmentedMediaInfo, getValue, setValue } from './settings';
import { join as pathJoin } from 'path';
import { ErrorMode, monitorProcess } from './process-util';
import { spawn } from 'child_process';
import { AudioTrack, MKVInfo, ProcessArgs, SubtitlesTrack, VideoStats, VideoTrack, VideoWalkOptions, VideoWalkOptionsPlus } from './shared-types';
import { comparator, compareCaseInsensitiveIntl, sorter, toStreamPath } from './shared-utils';
import { examineAndUpdateMkvFlags } from './mkv-flags';
import { sendStatus } from './app';
import { createFallbackAudio, createStreaming, killStreamingProcesses } from './streaming';
import { abs, max, min } from '@tubular/math';
import { mkvValidate } from './mkvalidator';
import { AsyncDatabase } from 'promised-sqlite3';

export const router = Router();
export let adminProcessing = false;
export let currentFile = '';
export let currentOp = '';
export let encodeProgress = '';
export let processArgs: ProcessArgs = null;
export let stopPending = false;
export let updateProgress = -1;

export function setStopPending(state: boolean): void {
  stopPending = state;
}

export function setEncodeProgress(s: string): void {
  encodeProgress = s;
}

export function setUpdateProgress(progress: number): void {
  updateProgress = progress;
}

const DEFAULT_VW_OPTIONS: VideoWalkOptions = {
  checkStreaming: true,
  directoryExclude: (_path: string, dir: string, depth: number): boolean => {
    return depth === 0 && (dir === 'Home movies' || dir === '_MISC_');
  },
  isStreamingResource: (file: string): boolean => {
    return /\.(mp4|mpd|webm)$/.test(file);
  }
};

export interface VideoWalkInfo {
  audio?: AudioTrack[];
  createdStreaming?: boolean;
  error?: string;
  isExtra?: boolean;
  isMovie?: boolean;
  isTV?: boolean;
  mkvInfo?: MKVInfo;
  skip?: boolean;
  streamingDirectory?: string;
  subtitles?: SubtitlesTrack[];
  title?: string;
  video?: VideoTrack[];
  videoDirectory?: string;
  wasModified?: boolean;
}

export type VideoWalkCallback = (path: string, depth: number, options?: VideoWalkOptionsPlus,
  info?: VideoWalkInfo) => Promise<void>;

export async function walkVideoDirectory(options: VideoWalkOptions, callback: VideoWalkCallback): Promise<VideoStats> {
  const dir = await getRemoteRecursiveDirectory();

  options = Object.assign(clone(DEFAULT_VW_OPTIONS), options);
  // getValue('videoDirectory');
  (options as VideoWalkOptionsPlus).streamingBasePath = getValue('streamingDirectory');
  (options as VideoWalkOptionsPlus).streamingDirectory = options.checkStreaming ? await getRemoteRecursiveDirectory(true) : undefined;
  (options as VideoWalkOptionsPlus).videoBasePath = getValue('videoDirectory');
  (options as VideoWalkOptionsPlus).videoDirectory = dir;
  (options as VideoWalkOptionsPlus).db = getDb();

  if (process.env.VS_ZIDOO_DB) {
    try {
      (options as VideoWalkOptionsPlus).zidooDb = await AsyncDatabase.open(process.env.VS_ZIDOO_DB);
    }
    catch (e) {
      console.error('Zidoo DB not available:', e.message);
    }
  }

  if (options.reportProgress) {
    (options as VideoWalkOptionsPlus).fileCount = 0;
    (options as VideoWalkOptionsPlus).totalFileCount = fileCountFromEntry(dir);
  }

  if (options.checkStreaming === true)
    options.checkStreaming = getValue('videoDirectory') + '\t' + getValue('streamingDirectory');

  if (options.walkStart)
    options.walkStartArray = options.walkStart.split('/').map(s => s.toLowerCase());

  if (options.walkStop)
    options.walkStopArray = options.walkStop.split('/').map(s => s.toLowerCase());

  return await walkVideoDirectoryAux((options as VideoWalkOptionsPlus).videoBasePath, dir, 0, options, callback);
}

const entryComparator = (x: DirectoryEntry, y: DirectoryEntry): number => comparator(x.name, y.name);

async function walkVideoDirectoryAux(dirPath: string, dir: DirectoryEntry[], depth: number, options: VideoWalkOptionsPlus,
                                     callback: VideoWalkCallback, dontRecurse = false): Promise<VideoStats> {
  const stats: VideoStats = {
    durations: new Map<string, number>(),
    dvdIsoCount: 0,
    errorCount: 0,
    extrasBytes: 0,
    extrasCount: 0,
    isoCount: 0,
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

  const entries = dir.sort(entryComparator);

  for (const entry of entries) {
    if (stopPending)
      break;

    const file = entry.name;
    const path = pathJoin(dirPath, file);
    const isDir = entry.isDir;
    let comp = -1;

    if (!isDir && options.reportProgress && /\.(iso|mkv)$/i.test(file)) {
      updateProgress = ++options.fileCount / options.totalFileCount * 100;
      webSocketSend({ type: 'videoStatsProgress', data: updateProgress });
    }

    if (entry.isLink || file.startsWith('.') || file.endsWith('~') || /~\.mkv$/i.test(file)) {
      // Do nothing
    }
    else if (options.walkStartArray?.length > depth &&
             compareCaseInsensitiveIntl(file, options.walkStartArray[depth]) < 0) {
      if (isDir) {
        options.fileCount += fileCountFromEntry(entry);
        updateProgress = options.fileCount / options.totalFileCount * 100;
        webSocketSend({ type: 'videoStatsProgress', data: updateProgress });
      }
    }
    else if (!options.walkStartArray && options.walkStopArray?.length > depth &&
             (depth === 0 || options.walkStopArray[depth - 1] === null) &&
             (options.walkStopArray[depth] === null ||
               ((comp = compareCaseInsensitiveIntl(file, options.walkStopArray[depth])) > 0 &&
                 !file.toLowerCase().startsWith(options.walkStopArray[depth])))) {
      options.walkStopArray[depth] = null;
      break;
    }
    else {
      if (comp >= 0)
        options.walkStopArray[depth] = null;

      if (isDir) {
        if (dontRecurse || options.directoryExclude && options.directoryExclude(path, file, depth))
          continue;

        const consolidateStats = (subStats: VideoStats): void => forEach(stats as any, (key, value) => {
          const counterpart = (subStats as any)[key];

          if (isNumber(value))
            (stats as any)[key] += (subStats as any)[key];
          else if (value instanceof Set)
            (counterpart as Set<string>).forEach(s => (value as Set<string>).add(s));
          else if (value instanceof Map)
            (counterpart as Map<string, number>).forEach((value2, key2) =>
              value.set(key2, max(value2 as number, value.get(key2) as number || 0))
            );
        });
        const subStats = await walkVideoDirectoryAux(path, entry.children, depth + 1, options, callback);

        if (stopPending)
          break;

        consolidateStats(subStats);

        if (isString(options.checkStreaming)) {
          const baseDirs = options.checkStreaming.split('\t');
          const relativePath = path.substring(baseDirs[0].length);
          const streamingDir = pathJoin(baseDirs[1], relativePath);
          const streamingEntries = pathToEntry(options.streamingDirectory, relativePath)?.children;

          if (streamingEntries) {
            const subStats = await walkVideoDirectoryAux(streamingDir, streamingEntries, depth + 1, options, callback, true);

            consolidateStats(subStats);
          }
        }
      }
      else {
        options.walkStartArray = undefined;

        if (/\.tmp\./i.test(file)) {
          // Do nothing
        }
        else if (options.isStreamingResource && options.isStreamingResource(file)) {
          stats.streamingFileBytes += entry.size;
          ++stats.streamingFileCount;

          if (options.reportStreamingToCallback)
            await callback(path, depth);
        }
        else if (/\.(mkv|iso)$/i.test(file)) {
          ++stats.videoCount;

          const info: VideoWalkInfo = {};
          let iso = false;

          if (/\.iso$/i.test(file)) {
            iso = true;

            try {
              const content = asLines((await monitorProcess(spawn('7z', ['l', '-slt', path]))));

              if (content.find(entry => entry === 'Path = VIDEO_TS'))
                ++stats.dvdIsoCount;
              else
                ++stats.isoCount;
            }
            catch {
              ++stats.isoCount;
            }
          }

          if (/[\\/](_Extras_|.*_Bonus\b.*)[\\/]/i.test(path)) {
            info.isExtra = true;
            stats.extrasBytes += entry.size;
            ++stats.extrasCount;
          }
          else if (/§/.test(path) && !/[\\/]Movies[\\/]/.test(path) || /- S\d\dE\d\d -/.test(file)) {
            info.isTV = true;
            stats.tvBytes += entry.size;
            ++stats.tvEpisodesRaw;
          }
          else {
            info.isMovie = true;
            stats.movieBytes += entry.size;
            ++stats.movieCountRaw;
          }

          if (info.isExtra && options.skipExtras || info.isMovie && options.skipMovies || info.isTV && options.skipTV) {
            ++stats.skippedForType;
            info.skip = true;
          }
          else if (options.earliest && +entry.mdate < +options.earliest) {
            ++stats.skippedForAge;
            info.skip = true;
          }

          try {
            if (!iso && options.getMetadata && !info.skip) {
              const mkvJson = (await monitorProcess(spawn('mkvmerge', ['-J', path])))
              // uid values exceed available numeric precision. Turn into strings instead.
                .replace(/("uid":\s+)(\d+)/g, '$1"$2"');

              info.mkvInfo = JSON.parse(mkvJson) as MKVInfo;
              info.video = info.mkvInfo.tracks.filter(t => t.type === 'video') as VideoTrack[];
              info.audio = info.mkvInfo.tracks.filter(t => t.type === 'audio') as AudioTrack[];
              info.subtitles = info.mkvInfo.tracks.filter(t => t.type === 'subtitles') as SubtitlesTrack[];

              const mediaJson = await getAugmentedMediaInfo(path);
              const mediaTracks = mediaJson.media?.track || [];
              const typeIndices = {} as Record<string, number>;

              for (const track of mediaTracks) {
                const type = track['@type'].toLowerCase();
                const index = (typeIndices[type] ?? -1) + 1;
                const mkvSet = (type === 'video' ? info.video : type === 'audio' ? info.audio : []);

                typeIndices[type] = index;

                if (mkvSet[index]?.properties)
                  mkvSet[index].properties.media = track;
              }

              const duration = info.mkvInfo.container.properties.duration / 1E9;
              const step = min(600, duration / 5);
              let [w, h] = (info.video[0]?.properties?.pixel_dimensions || '1x1').split('x').map(d => toInt(d));

              if (w > 1880 || h > 1000) {
                const db = (options as VideoWalkOptionsPlus).db;
                const key = path.substring(options.videoBasePath.length).normalize();
                const row = await db.get<any>('SELECT * FROM aspects WHERE key = ?', key);

                if (row && abs(row.mdate - +entry.mdate) < 1) {
                  info.video[0].properties.aspect = row.aspect;
                }
                else {
                  [w, h] = (info.video[0]?.properties?.display_dimensions || '1x1').split('x').map(d => toInt(d));
                  let newAspect = w / h;
                  let sizeInfo = '';

                  w = h = 0;

                  if (abs(newAspect - 1.78) < 0.03) {
                    for (let i = 1; i <= 4; ++i) {
                      sizeInfo += (await monitorProcess(spawn('ffmpeg',
                        ['-t', '5', '-ss', (step * i).toString(), '-i', path, '-vf', 'cropdetect,metadata=mode=print',
                         '-f', 'null', '-']), null, ErrorMode.COLLECT_ERROR_STREAM));
                    }

                    for (const line of asLines(sizeInfo)) {
                      const $ = /\bcropdetect\.([wh])=(\d+)/.exec(line);

                      if ($ && $[1] === 'w')
                        w = max(w, toInt($[2]));
                      else if ($ && $[1] === 'h')
                        h = max(h, toInt($[2]));
                    }

                    if (w === 0 || h === 0)
                      newAspect = null;
                    else
                      newAspect = w / h;
                  }
                  else
                    newAspect = null;

                  await db.run('INSERT OR REPLACE INTO aspects (key, mdate, aspect) VALUES (?, ?, ?)', key, +entry.mdate, newAspect);
                }
              }
            }

            const baseTitle = file.replace(/( ~)?\.mkv$/i, '');
            let title = baseTitle;
            const uri = ('/' + path.substring(options.videoBasePath.length)).replace(/\\/g, '/').replace(/^\/\//, '/');

            if (info.isMovie || info.isTV) {
              title = baseTitle.replace(/\s*\(.*?[a-z].*?\)/gi, '').replace(/^\d{1,2} - /, '').replace(/ - /g, ': ')
                .replace(/：/g, ':').replace(/？/g, '?').trim().replace(/(.+), (A|An|The)$/, '$2 $1');

              if (info.isMovie) {
                title = title.replace(/-S\d\dE\d\d-|-M\d-/, ': ').replace('\uFF1A', ':').replace('\uFF1F', '?');
                (stats.movieTitles as Set<string>).add(title);
              }
              else {
                (stats.tvEpisodeTitles as Set<string>).add(title);

                let $: RegExpExecArray;
                let seriesTitle = last(path.replace(/^\w:/, '').split(/[/\\]/).filter(s => s.includes('§')).map(s => s.trim()
                  .replace(/^\d+\s*-\s*/, '')
                  .replace(/§.*$/, '')
                  .replace('\uFF1A', ':')
                  .replace('\uFF1F', '?')
                  .replace(/\s+-\s+\d\d\s+-\s+/, ': ')
                  .replace(/\s+-\s+/, ': ')
                  .replace(/\s*\(.*?[a-z].*?\)/gi, '').trim()
                  .replace(/(.+), (A|An|The)$/, '$2 $1')));

                if (!seriesTitle && ($ = /(.*?): S\d\dE\d\d:/.exec(title)))
                  seriesTitle = $[1];

                if (seriesTitle) {
                  const pos = file.indexOf(seriesTitle);

                  if (pos > 0)
                    seriesTitle = file.substring(0, pos - 1) + ': ' + seriesTitle;

                  (stats.tvShowTitles as Set<string>).add(seriesTitle);
                }
              }
            }
            else if (info.isExtra)
              title = uri;

            title = title.normalize();

            if (!mappedDurations.has(uri)) {
              const mediainfo = await getAugmentedMediaInfo(path);
              const general = mediainfo?.media?.track?.find(t => t['@type'] === 'General');
              const duration = toNumber(general?.Duration);

              if (duration)
                mappedDurations.set(uri, duration);
            }

            if (mappedDurations.has(uri)) {
              const lastDuration = stats.durations.get(title) || 0;

              stats.durations.set(title, max(lastDuration, mappedDurations.get(uri)));
            }

            if (!iso && options.checkStreaming && !dontRecurse && !/[-_(](4K|3D)\)/.test(baseTitle)) {
              title = toStreamPath(baseTitle);

              const sDir = pathToEntry(options.streamingDirectory, dirPath.substring(options.videoBasePath.length))?.children;
              const stream1 = title + '.mpd';
              const stream2 = title + '.av.webm';
              const stream3 = '2K/' + title + '.mpd';
              const stream4 = '2K/' + title + '.av.webm';

              info.title = title = title.replace(/\s*\((\d*)#([-_.a-z0-9]+)\)/i, '');

              if (!pathExists(sDir, stream1) && !pathExists(sDir, stream2) && !pathExists(sDir, stream3) && !pathExists(sDir, stream4))
                (stats.unstreamedTitles as Set<string>).add(title);
            }

            info.streamingDirectory = options.streamingBasePath;
            info.videoDirectory = options.videoBasePath;
            await callback(path, depth, options, info);

            if (info.createdStreaming)
              (stats.unstreamedTitles as Set<string>).delete(info.title);
          }
          catch (e) {
            if (e !== null)
              console.error('Error while processing %s:', path, e);
          }
        }
        else {
          stats.miscFileBytes += entry.size;
          ++stats.miscFileCount;
        }
      }
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
      currentOp = 'lib';
      processArgs = null;
      sendStatus();
      updateLibrary(toBoolean(req.query.quick)).finally(() => {
        adminProcessing = false;
        stopPending = false;
        currentOp = '';
        sendStatus();
      });
    }

    res.json(!adminProcessing);
  }
});

router.post('/stop', async (req: Request, res: Response) => {
  if (!isAdmin(req))
    res.sendStatus(403);
  else {
    if (!stopPending) {
      stopPending = true;
      await killStreamingProcesses();
      sendStatus();
    }

    res.json(adminProcessing);
  }
});

export let statsInProgress = false;

interface UpdateOptions {
  canModify?: boolean;
  checkStreaming?: boolean;
  earliest?: Date;
  generateFallbackAudio?: boolean;
  generateStreaming?: boolean;
  mkvFlags?: boolean;
  mkvFlagsDryRun?: boolean,
  mkvFlagsUpdateBackups?: boolean,
  skipExtras?: boolean;
  skipMovies?: boolean;
  skipTV?: boolean;
  stats?: boolean;
  validate?: boolean;
  validateReset?: boolean;
  walkStart?: string;
  walkStop?: string;
}

function saveVideoStats(stats: VideoStats): void {
  const statsStr = JSON.stringify(stats, (_key, value) => {
    if (value instanceof Set)
      return Array.from(value.values()).sort(sorter);
    else
      return value;
  }, 2);

  if (!stopPending) {
    setValue('videoStats', statsStr);
    webSocketSend({ type: 'videoStats', data: statsStr });
  }
}

async function videoWalk(options: UpdateOptions): Promise<VideoStats> {
  let stats: VideoStats = null;

  if (!statsInProgress && !adminProcessing && (options.stats || options.mkvFlags || options.generateStreaming)) {
    statsInProgress = true;
    adminProcessing = true;
    updateProgress = 0;
    sendStatus();

    await (async (): Promise<void> => {
      try {
        stats = await walkVideoDirectory({
          canModify: options.canModify,
          checkStreaming: options.checkStreaming,
          earliest: options.earliest,
          getMetadata: options.mkvFlags || options.generateFallbackAudio || options.generateStreaming,
          mkvFlags: options.mkvFlags,
          mkvFlagsDryRun: options.mkvFlagsDryRun,
          generateFallbackAudio: options.generateFallbackAudio,
          generateStreaming: options.generateStreaming,
          reportProgress: true,
          walkStart: options.walkStart,
          walkStop: options.walkStop,
          validate: options.validate
        },
          async (path: string, _depth: number, options: VideoWalkOptionsPlus, info: VideoWalkInfo): Promise<void> => {
            const isMkv = !!/\.mkv$/i.test(path);

            if (info.skip)
              return;

            currentFile = path.substring(info.videoDirectory.length);
            webSocketSend({ type: 'currentFile', data: currentFile });

            if (options.generateFallbackAudio && isMkv)
              await createFallbackAudio(path, info);

            if (options.mkvFlags && isMkv)
              await examineAndUpdateMkvFlags(path, options, info);

            if (options.generateStreaming && isMkv)
              await createStreaming(path, options, info);

            if (options.validate && isMkv)
              await mkvValidate(path, options, info);
          });

        if ((options.generateStreaming || options.checkStreaming) && !options.walkStart && !options.walkStart) {
          stats.totalDuration = Array.from(stats.durations).map(d => d[1]).reduce((total, val) => total + val, 0);
          delete stats.durations;
          saveVideoStats(stats);
        }
      }
      catch (e) {
        console.error('Error compiling video stats');
        console.error(e);
      }
      finally {
        currentFile = '';
        encodeProgress = '';
        updateProgress = -1;
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
    currentOp = 'inv';
    processArgs = null;

    videoWalk({ checkStreaming: true, stats: true }).finally(() => {
      adminProcessing = false;
      stopPending = false;
      currentOp = '';
      sendStatus();
    });
  }

  jsonOrJsonp(req, res, stats);
});

router.post('/process', async (req, res) => {
  noCache(res);

  if (!adminProcessing) {
    currentOp = 'proc';
    processArgs = {
      earliest: req.body.earliest,
      fallback: toBoolean(req.body.generateFallbackAudio, null, true),
      mkvFlags: toBoolean(req.body.mkvFlags, null, true),
      mkvFlagsDryRun: toBoolean(req.body.mkvFlagsDryRun, null, true),
      mkvFlagsUpdateBackups: toBoolean(req.body.mkvFlagsUpdateBackups, null, true),
      skipExtras: toBoolean(req.body.skipExtras, null, true),
      skipMovies: toBoolean(req.body.skipMovies, null, true),
      skipTv: toBoolean(req.body.skipTV, null, true),
      start: req.body.walkStart,
      stop: req.body.walkStop,
      streaming: toBoolean(req.body.generateStreaming, null, true),
      validate: toBoolean(req.body.validate, null, true)
    };

    const canModify = processArgs.mkvFlags || processArgs.streaming;
    const options: UpdateOptions = {
      canModify,
      checkStreaming: processArgs.streaming,
      earliest: req.body.earliest ? new Date(req.body.earliest) : undefined,
      generateFallbackAudio: processArgs.fallback,
      generateStreaming: processArgs.streaming,
      mkvFlags: processArgs.mkvFlags,
      mkvFlagsDryRun: processArgs.mkvFlagsDryRun,
      mkvFlagsUpdateBackups: processArgs.mkvFlagsUpdateBackups,
      skipExtras: toBoolean(req.body.skipExtras, null, true),
      skipMovies: toBoolean(req.body.skipMovies, null, true),
      skipTV: toBoolean(req.body.skipTV, null, true),
      stats: true,
      validate: processArgs.validate,
      walkStart: req.body.walkStart,
      walkStop: req.body.walkStop
    };

    sendStatus();
    videoWalk(options).finally(() => {
      adminProcessing = false;
      stopPending = false;
      currentOp = '';
      processArgs = null;
      sendStatus();
    });
    res.send('OK');
  }
  else
    res.send('Busy');
});
