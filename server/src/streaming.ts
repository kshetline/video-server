import { extendDelimited, htmlEscape, toInt, toNumber } from '@tubular/util';
import { ChildProcess } from 'child_process';
import {  dirname, join } from 'path';
import { closeSync, mkdirSync, openSync } from 'fs';
import { mkdtemp, readFile, rename, symlink, utimes, writeFile } from 'fs/promises';
import { VideoWalkOptionsPlus } from './shared-types';
import { existsAsync, getLanguage, has2k2dVersion, safeLstat, safeUnlink, webSocketSend } from './vs-util';
import { abs, ceil, floor, min, round } from '@tubular/math';
import { ErrorMode, monitorProcess, ProcessInterrupt, spawn } from './process-util';
import { stopPending, VideoWalkInfo } from './admin-router';
import { toStreamPath } from './shared-utils';
import * as os from 'os';
import { lang2to3 } from './lang';
import { getAugmentedMediaInfo } from './settings';
import { existsSync, writeFileSync } from 'node:fs';

interface Progress {
  duration?: number;
  lastPercent?: number;
  percentStr?: string;
}

interface VideoProgress {
  errors?: Map<string, number>;
  duration?: number;
  lastOutput?: string;
  path: string;
  percent?: Map<string, number>;
  readFromError?: boolean;
  speed?: Map<string, number>;
  start: number;
}

interface VideoRender {
  args: string[];
  name: string;
  process?: ChildProcess;
  promise?: Promise<string>;
  tries: number;
  videoPath: string;
}

const SRT = '1\n00:00:01,000 --> 00:00:01,500\n.\n';
const SRT_FILE = 'dot.srt';

if (!existsSync(SRT_FILE)) {
  writeFileSync(SRT_FILE, SRT);
}

let currentProcesses: ChildProcess[] = [];
let currentTempFiles: string[] = [];
const isWindows = (os.platform() === 'win32');

function trackProcess(process: ChildProcess): ChildProcess {
  currentProcesses.push(process);

  const cleanUp = (): void => { currentProcesses = currentProcesses.filter(p => p !== process); };

  process.on('close', cleanUp);
  process.on('error', cleanUp);
  process.on('exit', cleanUp);

  return process;
}

function trackTempFile(file: string, remove = false): string {
  if (remove)
    currentTempFiles = currentTempFiles.filter(f => f !== file);
  else
    currentTempFiles.push(file);

  return file;
}

export async function killStreamingProcesses(): Promise<void> {
  for (const process of currentProcesses) {
    try {
      process.kill();
    }
    catch {}
  }

  await new Promise<void>(resolve => {
    let count = 0;
    const check = (): void => {
      if (currentProcesses.length === 0 || ++count > 100)
        resolve();
      else
        setTimeout(check, 100);
    };

    check();
  });

  currentProcesses = [];

  for (const file of currentTempFiles)
    await safeUnlink(file);

  currentTempFiles = [];
}

function aacProgress(data: string, stream: number, progress: Progress): void {
  if (stopPending)
    throw new ProcessInterrupt();

  progress.duration = progress.duration ?? -1;
  progress.lastPercent = progress.lastPercent ?? -1;
  progress.percentStr = progress.percentStr ?? '';

  const repair = (data === '#');

  if (repair || stream === 1) {
    let $: RegExpExecArray;

    if (progress.duration < 1 && ($ = /\bduration\b\s*:\s*(\d\d):(\d\d):(\d\d)/i.exec(data)))
      progress.duration = toInt($[1]) * 3600 + toInt($[2]) * 60 + toInt($[3]);

    if (progress.duration > 0 && (repair || ($ = /.*\btime=(\d\d):(\d\d):(\d\d)/.exec(data)))) {
      const elapsed = repair ? 0 : toInt($[1]) * 3600 + toInt($[2]) * 60 + toInt($[3]);
      const percent = repair ? 100 : round(elapsed * 100 / progress.duration);

      if (progress.lastPercent !== percent) {
        progress.lastPercent = percent;
        progress.percentStr = percent + '%' + (repair ? '#' : '');
        webSocketSend({ type: 'audio-progress', data: progress.percentStr });
      }
    }
  }
}

function videoProgress(data: string, stream: number, name: string, done: boolean, progress?: VideoProgress): void {
  progress.percent = progress.percent ?? new Map();
  progress.speed = progress.speed ?? new Map();
  progress.errors = progress.errors ?? new Map();
  progress.lastOutput = progress.lastOutput ?? '';

  const repair = (data === '#');

  if (repair || stream === 0 || (data && progress.readFromError) || done) {
    const duration = (name === '320p' ? 180000 : progress.duration);
    let $ = /task.+,\s*(\d+\.\d+)\s*%/.exec(data);
    let rawPercent = 0;

    if (repair)
      rawPercent = 100;
    else if ($)
      rawPercent = toNumber($[1]);
    else {
      $ = /time=(\d\d):(\d\d):(\d\d(\.\d+)?)/.exec(data);

      if ($) // Convert time to percentage
        rawPercent = (toInt($[1]) * 3600 + toInt($[2]) * 60 + toNumber($[3])) * 100_000 / duration;
    }

    if (done && stream > 0)
      progress.errors.set(name, (progress.errors.get(name) || 0) + 1);

    if ($ || rawPercent || (done && stream <= 0)) {
      const percent = stream < 0 ? -1 : (done ? 100 : min(round(rawPercent, 0.1), 99.9));
      const lastPercent = progress.percent.get(name) ?? -1;

      if (lastPercent !== percent) {
        progress.percent.set(name, percent);
        const elapsed = Date.now() - progress.start;
        const resolutions = Array.from(progress.percent.keys()).sort((a, b) => parseInt(a) - parseInt(b));

        progress.speed.set(name, stream < 0 ? -1 : duration * percent / 100 / elapsed);
        progress.lastOutput = resolutions.map(r => {
          const percent = progress.percent.get(r);
          const percentStr = percent < 0 ? '(redo)' : percent.toFixed(1).padStart(5) + '%' + (repair ? '#' : '');
          const speed = progress.speed.get(r) || 0;
          const speedStr = speed <= 0 ? '----' : speed.toFixed(2);

          return `${r}:${percentStr} (${speedStr}x)${'*'.repeat(progress.errors.get(r) || 0)}`;
        }).join(', ');

        webSocketSend({ type: 'video-progress', data: progress.lastOutput });
      }
    }
  }
}

function tmp(file: string): string {
  return file.replace(/(\.\w+)$/, '.tmp$1');
}

function formatTime(nanos: number): string {
  let secs = round(nanos / 10_000_000 + 0.5) / 100;
  const hours = floor(secs / 3600);
  secs -= hours * 3600;
  const minutes = floor(secs / 60);
  secs -= minutes * 60;

  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
}

async function checkAndFixBadDuration(path: string, progress: Progress | VideoProgress, name?: string): Promise<void> {
  const mediainfo = await getAugmentedMediaInfo(path);

  if (toNumber(mediainfo.media.track[0].Duration) > 86400) {
    if (name)
      videoProgress('#', 0, name, true, progress as VideoProgress);
    else
      aacProgress('#', 0, progress as Progress);

    const tmp = path.replace(/^(.*)(\.[^.]+)$/, '$1.tmp$2');

    await rename(path, tmp);

    try {
      await monitorProcess(trackProcess(spawn('ffmpeg', ['-i', tmp, '-c', 'copy', '-fflags', '+genpts', path])));
    }
    catch {
      await safeUnlink(path);
    }

    await safeUnlink(tmp);
  }
}

async function tryThrice(fn: () => Promise<any>): Promise<void> {
  let err: any;

  for (let i = 0; i < 3; ++i) {
    if (i > 0)
      await new Promise<void>(resolve => { setTimeout(resolve, 1000); });

    try {
      await fn();
      return;
    }
    catch (e) {
      err = e;
    }
  }

  throw err;
}

export async function createFallbackAudio(path: string, info: VideoWalkInfo): Promise<boolean> {
  const video = info.video && info.video[0];
  const [w, h] = (video?.properties.pixel_dimensions || '1x1').split('x').map(d => toInt(d));

  if (!video || w > 1920 || h > 1080 ||
      video.properties?.media?.Format_Profile?.includes('Stereo') || toInt(video.properties?.media?.MultiView_Count) > 1)
    return false;

  const audio = info.audio && info.audio[0];

  if (!audio || !audio.properties)
    return false;

  const lang = getLanguage(audio);
  const aacTrack = info.audio.findIndex(track => {
    const props = track.properties;

    return (track.codec === 'AAC' && getLanguage(props) === lang && props.audio_channels <= 2);
  });

  if (aacTrack >= 0)
    return false;

  const mainChannels = audio.properties.audio_channels;
  const args = ['-i', path, '-map', '0:1', '-c', 'aac', '-ac', min(mainChannels, 2).toString(),
                '-b:a', mainChannels < 2 ? '96k' : '192k'];
  const progress: Progress = {};
  const aacFile = join(os.tmpdir(), await mkdtemp('tmp-') + '.tmp.aac');

  if (mainChannels > 3)
    args.push('-af', 'aresample=matrix_encoding=dplii');

  args.push('-ar', '44100', aacFile);
  webSocketSend({ type: 'audio-progress', data: '    Generating AAC fallback audio started at ' + new Date().toLocaleString() });

  const backupPath = path.replace(/\.mkv$/i, '[zni].bak.mkv');
  const updatePath = path.replace(/\.mkv$/i, '[zni].upd.mkv');

  try {
    await safeUnlink(aacFile);
    await monitorProcess(spawn('ffmpeg', args), (data, stream) => aacProgress(data, stream, progress));

    trackTempFile(aacFile, true);

    if (stopPending) {
      await safeUnlink(aacFile);
      webSocketSend({ type: 'audio-progress', data: '' });
      return false;
    }

    webSocketSend({ type: 'audio-progress', data: 'Remuxing fallback audio...' });

    const nameStart = (/^(\w)\s+(AAC|DTS|E-AC3|FLAC|Surround|TrueHD)\b/.exec(audio.properties.track_name) || [])[1];
    const aacTrackName = (nameStart ? nameStart + ' ' : '') + (mainChannels > 3 ? 'Dolby PL2' : mainChannels > 1 ? 'AAC Stereo' : 'AAC Mono');
    const args2 = ['-o', updatePath, path];
    let tracks = '';

    for (let i = 0; i < info.video.length + 2; ++i)
      tracks += '0:' + i + ',';

    args2.push('--original-flag', '0', '--track-name', '0:' + aacTrackName, '--default-track', '0:no',
      '--language', '0:' + (lang2to3[lang] || lang || 'und'), aacFile, '--track-order', tracks + '1:0');

    let percentStr = '';
    const mergeProgress = (data: string, stream: number): void => {
      let $: RegExpExecArray;

      if (stream === 0 && ($ = /\bProgress: (\d{1,3}%)/.exec(data)) && percentStr !== $[1]) {
        if (percentStr)
          process.stdout.write('%\x1B[' + (percentStr.length + 1) + 'D');

        percentStr = $[1];
        process.stdout.write(percentStr + '\x1B[K');
      }
    };

    await safeUnlink(updatePath);
    await monitorProcess(spawn('mkvmerge', args2), mergeProgress, ErrorMode.DEFAULT, 4096);
    webSocketSend({ type: 'audio-progress', data: '' });

    if (!isWindows)
      await tryThrice(() => monitorProcess(spawn('chmod', ['--reference=' + backupPath, path]), null, ErrorMode.IGNORE_ERRORS));

    await tryThrice(() => rename(path, backupPath));
    await tryThrice(() => rename(updatePath, path));
    await tryThrice(() => safeUnlink(backupPath));
    await safeUnlink(aacFile);
  }
  catch {
    if (await existsAsync(backupPath)) {
      await tryThrice(() => rename(backupPath, path));
      await tryThrice(() => safeUnlink(updatePath));
    }

    await safeUnlink(aacFile);
    webSocketSend({ type: 'audio-progress', data: '' });

    return false;
  }

  return true;
}

export async function fixForcedSubtitles(path: string, info: VideoWalkInfo): Promise<boolean> {
  if ((info.subtitles ?? []).filter(t => t.properties?.default_track).length > 0)
    return false;

  const forced = (info.subtitles ?? []).filter(t => t.properties?.forced_track && getLanguage(t));

  if (forced.length === 0)
    return false;

  const audioLangs = new Set((info.audio ?? []).filter(t => getLanguage(t)).map(t => getLanguage(t)));
  const forcedLangs = new Set(forced.map(t => getLanguage(t)));
  const addedLangs = Array.from(audioLangs.values()).filter(l => !forcedLangs.has(l));
  const addedCount = addedLangs.length;

  if (addedCount < 1)
    return false;

  const start = Date.now();

  console.log('    Remuxing %s at %s for subtitle track', path, new Date().toLocaleString());

  const backupPath = path.replace(/\.mkv$/i, '[zni].bak.mkv');
  const updatePath = path.replace(/\.mkv$/i, '[zni].upd.mkv');
  const args = ['-o', updatePath, path];
  const insertAt = forced[0].id;
  let trackOrder = '';

  try {
    for (let i = 0; i < info.trackCount + addedCount; ++i) {
      if (i < insertAt)
        trackOrder += `0:${i},`;
      else if (i < insertAt + addedCount) {
        const index = i - insertAt;

        args.push('--language', `0:${addedLangs[index]}`,
                  '--track-name', '0:*', '--forced-track', '0:yes', '--default-track', '0:no',
                  '(', SRT_FILE, ')');
        trackOrder += `${index + 1}:0,`;
      }
      else
        trackOrder += `0:${i - addedCount},`;
    }

    args.push('--track-order', trackOrder.slice(0, -1));

    let percentStr = '';
    const remuxProgress = (data: string, stream: number): void => {
      let $: RegExpExecArray;

      if (stream === 0 && ($ = /\bProgress: (\d{1,3}%)/.exec(data)) && percentStr !== $[1]) {
        if (percentStr)
          process.stdout.write('%\x1B[' + (percentStr.length + 1) + 'D');

        percentStr = $[1];
        process.stdout.write(percentStr + '\x1B[K');
        webSocketSend({ type: 'video-progress', data: 'Remux: ' + percentStr });
      }
    };

    await safeUnlink(updatePath);
    await monitorProcess(spawn('mkvmerge', args), remuxProgress, ErrorMode.DEFAULT, 4096);
    webSocketSend({ type: 'video-progress', data: '' });

    if (!isWindows)
      await monitorProcess(spawn('chmod', ['--reference=' + path, updatePath]), null, ErrorMode.IGNORE_ERRORS);

    const oldStats = await safeLstat(path);

    if (oldStats) {
      // Keep modification time close to old time, just a minute or two later for rsync update purposes.
      const newDate = new Date(ceil(oldStats.mtime.getTime() + 60000, 1000));

      await utimes(updatePath, newDate, newDate);
    }

    await tryThrice(() => rename(path, backupPath));
    await tryThrice(() => rename(updatePath, path));
    await tryThrice(() => safeUnlink(backupPath));
  }
  catch {
    if (await existsAsync(backupPath)) {
      await tryThrice(() => rename(backupPath, path));
      await tryThrice(() => safeUnlink(updatePath));
    }

    webSocketSend({ type: 'video-progress', data: '' });

    return false;
  }

  const elapsed = Date.now() - start;

  console.log('    Total time remuxing: %s', formatTime(elapsed * 1000000).slice(0, -3));

  return true;
}

export async function createStreaming(path: string, options: VideoWalkOptionsPlus,
                                      info: VideoWalkInfo): Promise<boolean> {
  currentProcesses = [];
  currentTempFiles = [];

  const start = Date.now();
  const resolutions = [{ w: 1920, h: 1080 }, { w: 1280, h: 720 }, { w: 853.33, h: 480 }, { w: 640, h: 360 }, { w: 569, h: 320 }];
  const mpdRoot = toStreamPath(path, options.videoBasePath, options.streamingBasePath);
  const mpdPath = mpdRoot + '.mpd';
  const avPath = mpdRoot + '.av.webm';
  const mobilePath = mpdRoot + '.mobile.mp4';
  const samplePath = mpdRoot + '.sample.mp4';
  const busyPath = mpdRoot + '.busy';
  const video = info.video && info.video[0];
  const [w, h] = (video?.properties.pixel_dimensions || '1x1').split('x').map(d => toInt(d));
  const [wd, hd] = (video?.properties.display_dimensions || '1x1').split('x').map(d => toInt(d));
  const aspect = wd / hd;
  const threeD = !!video?.properties.stereo_mode;
  const fourK = h > 1100 || w > 1940;

  if (((threeD || fourK) && !!(await has2k2dVersion(path, threeD)) && !path.includes('(extended edition) (4K)')))
    return false;

  const hasDesktopVideo = await existsAsync(mpdPath) || await existsAsync(avPath);
  const hasMobile = await existsAsync(mobilePath);
  const hasSample = await existsAsync(samplePath);

  if (hasDesktopVideo && hasMobile && hasSample)
    return false;

  const parent = dirname(mpdPath);

  if (!await existsAsync(parent))
    mkdirSync(parent, { recursive: true });

  try {
    closeSync(openSync(busyPath, 'wx'));
    trackTempFile(busyPath);
  }
  catch {
    return false;
  }

  const shouldSkipVideo = (streamW: number, streamH: number): boolean =>
    (!info.isMovie && streamH === 1080) || (info.isExtra && streamH > 480) || (streamW > w * 1.25 && streamH > h * 1.25) ||
    (hasDesktopVideo && streamH >= 480) || (hasMobile && streamH === 360) || (hasSample && streamH === 320);
  const videoCount = !video ? 0 : resolutions.reduce((total, r) => total + (shouldSkipVideo(r.w, r.h) ? 0 : 1), 0);
  const groupedVideoCount = videoCount - (hasMobile || !video ? 0 : 1) - (hasSample || !video ? 0 : 1);
  const audios = info.audio || [];
  const subtitles = info.subtitles || [];
  const duration = info.mkvInfo.container.properties.duration / 1000000;
  let audio = audios[0];
  const audioIndex = audio ? info.audio.findIndex(a => a === audio) : -1;
  let audioPath: string;

  // Surround tracks from these videos mix down terribly to stereo for some odd reason.
  if (/Star Trek\b.*\bThe Original Series/i.test(path))
    audio = audios.find(a => a.codec === 'AAC' && a.properties.audio_channels <= 2) ||
      audios.find(a => a.properties.audio_channels <= 2) || audio;

  const mono = audio?.properties.audio_channels === 1;
  const surround = audio?.properties.audio_channels > 3;
  const mixdown = mono || !surround ? [] : ['-af', 'aresample=matrix_encoding=dplii'];
  let audioArgs: string[];

  if (audioIndex >= 0)
    audioArgs = [`-c:a:${audioIndex}`, 'libvorbis', '-ac', mono ? '1' : '2', '-ar', '44100', '-b:a',
                 mono ? '96k' : '128k', ...mixdown];

  console.log('    Generating streaming content started for %s at %s', path, new Date().toLocaleString());

  if (audioIndex >= 0 && groupedVideoCount !== 1 && !hasDesktopVideo) {
    audioPath = `${mpdRoot}.${groupedVideoCount === 0 ? 'av' : 'audio'}.webm`;

    if (!await existsAsync(audioPath)) {
      const args = ['-i', path, '-vn', '-sn', ...audioArgs, '-dash', '1', '-f', 'webm', trackTempFile(tmp(audioPath)),
                    '-map_chapters', '-1'];
      const progress: Progress = {};

      if (groupedVideoCount === 0)
        args.splice(args.indexOf('-dash'), 2);

      for (let i = 0; i < audios.length; ++i) {
        try {
          await safeUnlink(tmp(audioPath));
          await monitorProcess(trackProcess(spawn('ffmpeg', args)), (data, stream) => aacProgress(data, stream, progress),
            ErrorMode.DEFAULT, 4096);
          await rename(trackTempFile(tmp(audioPath), true), audioPath);
          await checkAndFixBadDuration(audioPath, progress);
          break;
        }
        catch (e) {
          if (stopPending)
            return false;

          if (i === audios.length - 1) {
            await safeUnlink(busyPath);

            if (stopPending)
              return false;
            else
              throw e;
          }

          args[4] = '0:a:' + (audioIndex !== 0 && i === audioIndex ? 0 : i + 1);
        }
      }

      console.log();
    }
  }

  const subtitleIndex = subtitles.findIndex(s => s.properties.default_track);
  // TODO: Add other text subtitle codecs
  const isGraphicSub = subtitleIndex >= 0 && !/^(SubRip\/SRT)$/.test(subtitles[subtitleIndex].codec);
  const dashVideos: string[] = [];
  const symlinkName = 'sublink.mkv';
  let sublink = '';

  if (video) {
    const videoQueue: VideoRender[] = [];
    const progress: VideoProgress = { duration, path, readFromError: true, start: Date.now() };
    const media = video.properties?.media;
    const hdr = !!(media?.HDR_Format && /^HDR/.test(media?.HDR_Format_Compatibility));

    for (const resolution of resolutions) {
      if (shouldSkipVideo(resolution.w, resolution.h))
        continue;

      const small = resolution.h < 480;
      const format = (small ? 'mp4' : 'webm');
      const codec = (small ? ['h264'] : ['vp9', '-row-mt', '1']);
      const ext = (small ? (resolution.h === 320 ? 'sample.mp4' : 'mobile.mp4') : 'webm');
      const videoPath = `${mpdRoot}${small ? '' : '.' + (groupedVideoCount === 1 ? 'av' : 'v' + resolution.h)}.${ext}`;
      const args = ['-y', '-progress', '-', '-i', path, '-c:v', ...codec, '-crf', '24'];
      let hasAudio = false;

      if (!small)
        dashVideos.push(videoPath);

      if (await existsAsync(videoPath))
        continue;

      const targetW = (resolution.h !== 480 || aspect > 1.334 ? resolution.w : 640);
      let encodeW = targetW;
      let encodeH = targetW / aspect;
      let anamorph = 1;
      let filter = '';
      let subtitleInput = '0:v';

      if (encodeH > resolution.h) {
        encodeH = resolution.h;
        encodeW = resolution.h * aspect;
      }

      if (resolution.h === 480) {
        anamorph = (encodeW >= 640 ? 32 / 27 : 8 / 9);
        encodeW /= anamorph;
      }

      if (abs(encodeW - w) / w > 0.05 && abs(encodeH - h) / h > 0.05) {
        args.push('-s', `${round(encodeW, 2)}x${round(encodeH, 2)}`);

        if (anamorph !== 1)
          args.push('-sar', (anamorph > 1 ? '32:27' : '8:9'));
      }

      if (resolution.h === 320) // For sample video clip
        args.push('-ss', duration < 480000 ? '00:00:00' : '00:05:00', '-t', '180'); // TODO: Handle non-image subtitles

      if (hdr) {
        filter = '[0:v]zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p[v0]';
        subtitleInput = 'v0';
      }

      if (subtitleIndex >= 0) {
        if (isGraphicSub)
          filter = extendDelimited(filter, `[${subtitleInput}][0:s:${subtitleIndex}]overlay[v]`, ';');
        else {
          let subpath = path;

          if (/[',\\]/.test(path)) {
            if (!sublink) {
              await safeUnlink(symlinkName);
              await symlink(path, symlinkName);
              sublink = symlinkName;
              trackTempFile(sublink, true);
            }

            subpath = sublink;
          }

          filter = extendDelimited(filter, `[${subtitleInput}]subtitles=${subpath}:si=${subtitleIndex}[v]`, ';');
        }
      }
      else if (filter)
        filter = filter.replace('[v0]', '[v]');

      const addAudio = (groupedVideoCount === 1 || small) && audioIndex >= 0;

      if (filter) {
        args.push('-filter_complex', filter, '-map', '[v]');

        if (addAudio)
          args.push('-map', 'a:0');
      }

      if (subtitleIndex < 0)
        args.push('-sn');

      if (addAudio) {
        args.push(...audioArgs);
        hasAudio = true;

        if (small)
          args[args.indexOf('libvorbis')] = 'aac';
      }
      else
        args.push('-an');

      if (!small && !hasAudio)
        args.push('-dash', '1');

      args.push('-map_chapters', '-1', '-f', format, trackTempFile(tmp(videoPath)));
      videoQueue.push({ args, name: resolution.h + 'p', tries: 0, videoPath });
    }

    await new Promise<void>((resolve, reject) => {
      const simultaneousMax = 6;
      const maxTries = 6;
      let running = 0;
      let done = false;
      const redoQueue: VideoRender[] = [];

      const cleanUpAndFail = (err: Error): void => {
        setTimeout(() => {
          videoQueue.push(...redoQueue);
          videoQueue.forEach(task => {
            try {
              if (task.process)
                task.process.kill();
            }
            catch {}
          });
          safeUnlink(busyPath);
          reject(err);
        });
      };

      const startTask = (task: VideoRender): void => {
        task.process = trackProcess(spawn('ffmpeg', task.args, { maxbuffer: 20971520 }));
        task.promise = monitorProcess(task.process, (data, stream, done) =>
          videoProgress(data, stream, task.name, done, progress), ErrorMode.DEFAULT, 4096);
      };

      const checkQueue = (): void => {
        if (done) {}
        else if (stopPending) {
          cleanUpAndFail(null);
          done = true;
          resolve();
        }
        else if (running < simultaneousMax && videoQueue.length > 0) {
          const task = videoQueue.pop();
          const moveOn = (): void => {
            rename(trackTempFile(tmp(task.videoPath), true), task.videoPath).finally(() => {
              checkAndFixBadDuration(task.videoPath, progress, task.name).finally(() => {
                --running;
                checkQueue();
              });
            });
          };

          ++running;
          startTask(task);
          task.promise.then(() => moveOn()).catch(err => {
            task.process = undefined;

            const percentDone = progress.percent?.get(task.name) || 0;

            // Sometimes an error is thrown at the last moment, but the file generated is perfectly usable
            if (percentDone > 99.89 && /error writing trailer|pts\/dts pair unsupported/i.test(err?.message)) {
              progress.percent.set(task.name, 100);
              progress.errors.set(task.name, Math.max(progress.errors.get(task.name) - 1, 0));
              moveOn();
            }
            else {
              --running;

              if (++task.tries < maxTries * 3 / 4 && percentDone < 10 || task.tries < maxTries / 2) {
                videoQueue.splice(0, 0, task);
                videoProgress('', -1, task.name, true, progress);
                checkQueue();
              }
              else {
                redoQueue.push(task);
                videoProgress('', -1, task.name, true, progress);
                checkQueue();
              }
            }
          });

          checkQueue();
        }
        else if (running === 0 && redoQueue.length > 0) {
          const task = redoQueue.splice(0, 1)[0];
          const wrapUpTask = (): any => rename(trackTempFile(tmp(task.videoPath), true), task.videoPath).finally(() =>
            checkAndFixBadDuration(task.videoPath, progress, task.name).finally(() => checkQueue())
          );

          startTask(task);
          task.promise.then(wrapUpTask)
          .catch(err => {
            const percentDone = progress.percent?.get(task.name) || 0;

            // Sometimes an error is thrown at the last moment, but the file generated is perfectly usable
            if (percentDone > 99.89 && /error writing trailer|pts\/dts pair unsupported/i.test(err?.message)) {
              progress.percent.set(task.name, 100);
              progress.errors.set(task.name, Math.max(progress.errors.get(task.name) - 1, 0));
              wrapUpTask();
            }
            else if (++task.tries < maxTries) {
              task.process = undefined;
              redoQueue.push(task);
              videoProgress('', -1, task.name, true, progress);
              checkQueue();
            }
            else
              cleanUpAndFail(err);
          });
        }
        else if (running === 0) {
          done = true;
          resolve();
        }
      };

      checkQueue();
    });

    console.log();
  }

  if (stopPending)
    return false;
  else if (groupedVideoCount > 1) {
    const args: string[] = [];

    dashVideos.reverse().forEach(v => args.push('-f', 'webm_dash_manifest', '-i', v));

    if (audioPath)
      args.push('-f', 'webm_dash_manifest', '-i', audioPath);

    args.push('-c', 'copy');

    for (let i = 0; i < dashVideos.length + (audioPath ? 1 : 0); ++i)
      args.push('-map', i.toString());

    let sets = 'id=0,streams=0';

    if (dashVideos.length > 0) {
      sets += ',1,2'.substring(0, (dashVideos.length - 1) * 2);

      if (audioPath)
        sets += ' id=1,streams=' + dashVideos.length;
    }

    args.push('-f', 'webm_dash_manifest', '-adaptation_sets', sets, trackTempFile(tmp(mpdPath)));
    webSocketSend({ type: 'video-progress', data: 'Generating DASH manifest' });

    try {
      await monitorProcess(trackProcess(spawn('ffmpeg', args)), null, ErrorMode.DEFAULT);
      await rename(trackTempFile(tmp(mpdPath), true), mpdPath);
    }
    catch (e) {
      if (stopPending) {
        await safeUnlink(mpdPath);

        return false;
      }

      console.error(e);
      await safeUnlink(busyPath);
      throw e;
    }

    // Fix manifest file paths
    await writeFile(mpdPath, (await readFile(mpdPath, 'utf8')).toString()
      .replace(/(<BaseURL>)(.*?)(<\/BaseURL>)/g, (_0, $1, $2, $3) => {
        let path = $2;

        if (/[&<>]/.test(path) && !/&[#a-z0-9]+;/i.test(path))
          path = htmlEscape($2);

        return $1 + path + $3;
      }), 'utf8');

    webSocketSend({ type: 'video-progress', data: '' });
  }

  const elapsed = Date.now() - start;

  console.log('    Total time generating streaming content: %s (%sx)',
    formatTime(elapsed * 1000000).slice(0, -3), (duration / elapsed).toFixed(2));
  await safeUnlink(busyPath);

  if (sublink)
    await safeUnlink(sublink);

  info.createdStreaming = true;

  return true;
}
