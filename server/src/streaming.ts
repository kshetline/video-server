import { htmlEscape, toInt, toNumber } from '@tubular/util';
import { ChildProcess } from 'child_process';
import { dirname } from 'path';
import { closeSync, mkdirSync, openSync } from 'fs';
import { readFile, rename, writeFile } from 'fs/promises';
import { VideoWalkOptionsPlus } from './shared-types';
import { existsAsync, safeUnlink, webSocketSend } from './vs-util';
import { abs, floor, min, round } from '@tubular/math';
import { ErrorMode, monitorProcess, spawn } from './process-util';
import { VideoWalkInfo } from './admin-router';
import { toStreamPath } from './shared-utils';

interface Progress {
  duration?: number;
  lastPercent?: number;
  path: string;
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

function aacProgress(data: string, stream: number, progress: Progress): void {
  progress.duration = progress.duration ?? -1;
  progress.lastPercent = progress.lastPercent ?? -1;
  progress.percentStr = progress.percentStr ?? '';

  if (stream === 1) {
    let $: RegExpExecArray;

    if (progress.duration < 1 && ($ = /\bduration\b\s*:\s*(\d\d):(\d\d):(\d\d)/i.exec(data)))
      progress.duration = toInt($[1]) * 3600 + toInt($[2]) * 60 + toInt($[3]);

    if (progress.duration > 0 && ($ = /.*\btime=(\d\d):(\d\d):(\d\d)/.exec(data))) {
      const elapsed = toInt($[1]) * 3600 + toInt($[2]) * 60 + toInt($[3]);
      const percent = round(elapsed * 100 / progress.duration);

      if (progress.lastPercent !== percent) {
        progress.lastPercent = percent;
        progress.percentStr = percent + '%';
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

  if (stream === 0 || (data && progress.readFromError) || done) {
    const duration = (name === '320p' ? 180000 : progress.duration);
    let $ = /task.+,\s*(\d+\.\d+)\s*%/.exec(data);
    let rawPercent = 0;

    if ($)
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
          const percentStr = percent < 0 ? '(redo)' : percent.toFixed(1).padStart(5) + '%';
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

// export async function createStreaming(path: string, audios: AudioTrack[], video: VideoTrack,
//                                subtitles: SubtitlesTrack[], isMovie: boolean, isExtra: boolean,
//                                duration: number, videoBase: string, streamBase: string): Promise<boolean> {
export async function createStreaming(path: string, options: VideoWalkOptionsPlus,
                                      info: VideoWalkInfo): Promise<boolean> {
  const start = Date.now();
  const resolutions = [{ w: 1920, h: 1080 }, { w: 1280, h: 720 }, { w: 853.33, h: 480 }, { w: 640, h: 360 }, { w: 569, h: 320 }];
  const mpdRoot = toStreamPath(path, options.videoDirectory, options.streamingDirectory);
  const mpdPath = mpdRoot + '.mpd';
  const avPath = mpdRoot + '.av.webm';
  const mobilePath = mpdRoot + '.mobile.mp4';
  const samplePath = mpdRoot + '.sample.mp4';
  const busyPath = mpdRoot + '.busy';
  const video = info.video && info.video[0];
  const [w, h] = (video?.properties.pixel_dimensions || '1x1').split('x').map(d => toInt(d));
  const [wd, hd] = (video?.properties.display_dimensions || '1x1').split('x').map(d => toInt(d));
  const aspect = wd / hd;

  if ((h > 1100 && !path.includes('(extended edition) (4K)')) || video?.properties.stereo_mode)
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

  if (path.includes('Star Trek - 01 - The Original Series')) // Surround tracks from these videos mix down terribly to stereo for some odd reason.
    audio = audios.find(a => a.codec === 'AAC' && a.properties.audio_channels <= 2) ||
      audios.find(a => a.properties.audio_channels <= 2) || audio;

  const mono = audio.properties.audio_channels === 1;
  const surround = audio.properties.audio_channels > 3;
  const mixdown = mono || !surround ? [] : ['-af', 'aresample=matrix_encoding=dplii'];
  let audioArgs: string[];

  if (audioIndex >= 0)
    audioArgs = [`-c:a:${audioIndex}`, 'libvorbis', '-ac', mono ? '1' : '2', '-ar', '44100', '-b:a',
                 mono ? '96k' : '128k', ...mixdown];

  console.log('    Generating streaming content started at', new Date().toLocaleString());

  if (audioIndex >= 0 && groupedVideoCount !== 1 && !hasDesktopVideo) {
    audioPath = `${mpdRoot}.${groupedVideoCount === 0 ? 'av' : 'audio'}.webm`;

    if (!await existsAsync(audioPath)) {
      const args = ['-i', path, '-vn', '-sn', ...audioArgs, '-dash', '1', '-f', 'webm', tmp(audioPath),
                    '-map_chapters', '-1'];
      const progress: Progress = { path };

      if (groupedVideoCount === 0)
        args.splice(args.indexOf('-dash'), 2);

      for (let i = 0; i < audios.length; ++i) {
        try {
          await safeUnlink(tmp(audioPath));
          await monitorProcess(spawn('ffmpeg', args), (data, stream) => aacProgress(data, stream, progress),
            ErrorMode.DEFAULT, 4096);
          await rename(tmp(audioPath), audioPath);
          break;
        }
        catch (e) {
          if (i === audios.length - 1) {
            await safeUnlink(busyPath);
            throw e;
          }

          args[4] = '0:a:' + (audioIndex !== 0 && i === audioIndex ? 0 : i + 1);
        }
      }

      console.log();
    }
  }

  const subtitleIndex = subtitles.findIndex(s => s.properties.track_name === 'en' || s.properties.forced_track);
  const dashVideos: string[] = [];

  if (video) {
    const videoQueue: VideoRender[] = [];
    const progress: VideoProgress = { duration, path, readFromError: true, start: Date.now() };

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

      if (subtitleIndex >= 0) // TODO: Handle non-image subtitles
        args.push('-filter_complex', `[0:v][0:s:${subtitleIndex}]overlay[v]`, '-map', '[v]');
      else
        args.push('-sn');

      if ((groupedVideoCount === 1 || small) && audioIndex >= 0) {
        args.push(...audioArgs);
        hasAudio = true;

        if (small)
          args[args.indexOf('libvorbis')] = 'aac';
      }
      else
        args.push('-an');

      if (!small && !hasAudio)
        args.push('-dash', '1');

      args.push('-map_chapters', '-1', '-f', format, tmp(videoPath));
      videoQueue.push({ args, name: resolution.h + 'p', tries: 0, videoPath });
    }

    await new Promise<void>((resolve, reject) => {
      const simultaneousMax = 6;
      const maxTries = 6;
      let running = 0;
      const redoQueue: VideoRender[] = [];

      const cleanUpAndFail = (err: any): void => {
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
        task.process = spawn('ffmpeg', task.args, { maxbuffer: 20971520 });
        task.promise = monitorProcess(task.process, (data, stream, done) =>
          videoProgress(data, stream, task.name, done, progress), ErrorMode.DEFAULT, 4096);
      };

      const checkQueue = (): void => {
        if (running < simultaneousMax && videoQueue.length > 0) {
          const task = videoQueue.pop();

          ++running;
          startTask(task);
          task.promise.then(() => {
            rename(tmp(task.videoPath), task.videoPath).finally(() => {
              --running;
              checkQueue();
            });
          }).catch(() => {
            task.process = undefined;
            --running;

            const percentDone = progress.percent?.get(task.name) || 0;

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
          });

          checkQueue();
        }
        else if (running === 0 && redoQueue.length > 0) {
          const task = redoQueue.splice(0, 1)[0];

          startTask(task);
          task.promise.then(() => rename(tmp(task.videoPath), task.videoPath).finally(() => checkQueue()))
          .catch(err => {
            if (++task.tries < maxTries) {
              task.process = undefined;
              redoQueue.push(task);
              videoProgress('', -1, task.name, true, progress);
              checkQueue();
            }
            else
              cleanUpAndFail(err);
          });
        }
        else if (running === 0)
          resolve();
      };

      checkQueue();
    });

    console.log();
  }

  if (groupedVideoCount > 1) {
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

    args.push('-f', 'webm_dash_manifest', '-adaptation_sets', sets, tmp(mpdPath));
    webSocketSend({ type: 'video-progress', data: 'Generating DASH manifest' });

    try {
      await monitorProcess(spawn('ffmpeg', args), null, ErrorMode.DEFAULT);
      await rename(tmp(mpdPath), mpdPath);
    }
    catch (e) {
      console.error(e);
      await safeUnlink(busyPath);
      throw e;
    }

    // Fix manifest file paths
    await writeFile(mpdPath, (await readFile(mpdPath, 'utf8')).toString()
      .replace(/(<BaseURL>).*[/\\](.*?)(<\/BaseURL>)/g, (_0, $1, $2, $3) => {
        let path = $2;

        if (/[&<>]/.test(path) && !/&[#a-z0-9]+;/.test(path))
          path = htmlEscape($2);

        return $1 + path + $3;
      }), 'utf8');

    webSocketSend({ type: 'video-progress', data: '' });
  }

  const elapsed = Date.now() - start;

  console.log('    Total time generating streaming content: %s (%sx)',
    formatTime(elapsed * 1000000).slice(0, -3), (duration / elapsed).toFixed(2));
  await safeUnlink(busyPath);

  return true;
}
