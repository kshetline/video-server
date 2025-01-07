import { basename } from 'path';
import { makePlainASCII, processMillis } from '@tubular/util';
import { ErrorMode, monitorProcess, ProcessInterrupt } from './process-util';
import { spawn } from 'child_process';
import { safeLstat, safeUnlink, webSocketSend } from './vs-util';
import { stopPending, VideoWalkInfo } from './admin-router';
import { VideoWalkOptionsPlus } from './shared-types';
import { abs } from '@tubular/math';

export async function mkvValidate(path: string, options: VideoWalkOptionsPlus, _info: VideoWalkInfo): Promise<boolean> {
  let linkName = '';
  let error: string = null;
  const db = options.db;
  const key = path.substring(options.videoDirectory.length).normalize();
  const stat = await safeLstat(path);
  const row = await db.get<any>('SELECT * FROM validation WHERE key = ?', key);

  if (row && abs(row.mdate - stat.mtimeMs) < 3)
    return !row.error;

  if (!stat)
    error = 'File not found';
  else {
    try {
      console.log('Validating:', path);

      linkName = makePlainASCII(basename(path), true);
      await monitorProcess(spawn('ln', ['-s', path, linkName]));

      let lastFeedback = 0;
      let dots = '';
      const result = (await monitorProcess(spawn('mkvalidator', [linkName]), () => {
        if (stopPending)
          throw new ProcessInterrupt();

        const now = processMillis();

        if (now > lastFeedback + 250) {
          lastFeedback = now;
          dots = dots.length < 40 ? dots + '.' : '.';
          webSocketSend({ type: 'video-progress', data: dots });
        }
      }, ErrorMode.COLLECT_ERROR_STREAM)).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+/g, '\n')
        .replace(/^(\.|\s)+$/gm, '').trim();

      const allCount = (result.match(/^(ERR|WRN)[0-9A-F]{3}:/gm) || []).length;

      if (allCount > 12 || /^ERR[0-9A-F]{3}:/m.test(result) || /^WRN(?!(0B8|0C0|0C2|0D0|0E7|103))[0-9A-F]{3}:/m.test(result)) {
        const errCount = (result.match(/^ERR[0-9A-F]{3}:/gm) || []).length;
        const warnCount = (result.match(/^WRN[0-9A-F]{3}:/gm) || []).length;
        const $0C2Count = (result.match(/^WRN0C2:/gm) || []).length;
        const $861Count = (result.match(/^WRN861:/gm) || []).length;

        if (errCount > 0 || $861Count > 0 || warnCount - $0C2Count > 5) {
          console.log(result);
          error = result;
        }
      }
    }
    catch (e) {
      if (e.code !== -999999) {
        console.log('Failed:', e.message);
        error = e.message;
      }
    }
  }

  if (linkName)
    await safeUnlink(linkName);

  if (!stopPending)
    await db.run('INSERT OR REPLACE INTO validation (key, mdate, error) VALUES (?, ?, ?)', key, stat?.mtimeMs || Date.now(), error);

  return !error;
}
