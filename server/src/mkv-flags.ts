import { VideoWalkInfo } from './admin-router';
import { AudioTrackProperties, GeneralTrack, MediaInfo, MediaTrack, VideoWalkOptionsPlus } from './shared-types';
import { code2Name } from './lang';
import { isWindows, regexEscape, toBoolean, toInt } from '@tubular/util';
import { ErrorMode, linuxEscape, monitorProcess } from './process-util';
import { spawn } from 'child_process';
import { existsAsync, formatTime, getLanguage, getMkvWalkInfo, ProgressReporter, safeLstat, safeUnlink, tryThrice, webSocketSend } from './vs-util';
import { join } from 'path';
import { abs, ceil, max } from '@tubular/math';
import { rename, utimes } from 'fs/promises';

const ONE_WEEK = 7 * 86400 * 1000;

function getCodec(track: GeneralTrack): string {
  if (!track)
    return '';

  let codec = track.codec || '';

  if (codec === 'DTS-HD Master Audio') {
    if (track.properties?.media?.Format_Commercial_IfAny.includes('DTS:X') ||
        /\bXLL X\b/.test(track.properties?.media?.Format_AdditionalFeatures))
      codec = 'DTS-X';
    else
      codec = 'DTS-HD MA';
  }
  else if (codec === 'DTS-HD High Resolution Audio')
    codec = 'DTS-HD HRA';
  else if (codec === 'AC-3 Dolby Surround EX')
    codec = 'DD EX';
  else if (codec === 'E-AC-3')
    codec = 'E-AC3';
  else if (/\bH.264\b/.test(codec))
    codec = 'H.264';
  else if (/\bH.265\b/.test(codec))
    codec = 'H.265';
  else if (codec === 'SubStationAlpha')
    codec = 'SSA';
  else if (/\bPGS\b/.test(codec))
    codec = 'PGS';

  if (track.properties?.media && track.properties.media['@type'] === 'Video') {
    const media = track.properties.media;

    if (toInt(media.BitDepth) > 8)
      codec += ' ' + media.BitDepth + '-bit';

    if (media.HDR_Format)
      codec += ' HDR';
  }

  return codec;
}

function channelString(track: AudioTrackProperties): string {
  // The code below is a bit iffy. It's working for me for now, but there's some stuff I don't
  // fully understand about channel info, particularly how the `XXX_Original` variants are
  // supposed to work. No answers from the mediainfo forum yet!
  const channels = track.audio_channels;
  const sub = (!track.media && channels > 4) ||
    /\bLFE\b/.test(track.media?.ChannelLayout) || /\bLFE\b/.test(track.media?.ChannelPositions) ||
    /\bLFE\b/.test(track.media?.ChannelLayout_Original) || /\bLFE\b/.test(track.media?.ChannelPositions_Original);

  if (channels === 1 && !sub)
    return 'Mono';
  else if (channels === 2 && !sub)
    return 'Stereo';
  else if (!sub)
    return channels + '.0';
  else
    return (channels - 1) + '.1';
}

export async function examineAndUpdateMkvFlags(path: string, options: VideoWalkOptionsPlus,
                                               info: VideoWalkInfo): Promise<boolean> {
  const editArgs = [path];
  const audio = info.audio;
  const subtitles = info.subtitles;
  let primaryLang = '';
  let newDate = new Date(ceil(Date.now(), 1000));
  const stats = await safeLstat(path);
  const badDate = stats && stats.mtime.getTime() < 100000;
  let oldAudio: MediaTrack[];
  const changedNames: string[] = [];
  let allBlankNames = true;

  for (const track of [...audio, ...subtitles]) {
    if (track.properties?.track_name) {
      allBlankNames = false;
      break;
    }
  }

  if (info.isTV) {
    const origTitle = info.general?.Title;
    const hasDisc = /\bDisc \d+\b/i.test(origTitle);
    const name = path.replace(/.*[/\\]/, '').replace(/\.\w{2,4}$/, '');
    const match = /^(.*) - (\bS\d\dE\d\d\b) - (.*)$/i.exec(name) ?? [];
    const episode = (match[2] || '').toUpperCase();
    const series = info.seriesTitle || match[1] || '';
    let title = origTitle;

    if (episode && (!title || !origTitle.includes('•')) || hasDisc) {
      if (!title || hasDisc)
        title = (match[3] || '').replace(' - ', ': ').replace('？', '?').replace('：', ':').replace('／', '/')
          .replace(/\s*\([234][DK]\)/i, '').replace(/\s*\(\d*#[-a-z]+\)/i, '');

      title = `${series} • ${episode} • ${title}`;
    }

    if (title !== origTitle) {
      changedNames.push(origTitle || '(blank title)');
      editArgs.push('--edit', 'info', '--set', 'title=' + title, '--tags', 'global:');
    }
  }

  if (options.zidooDb && toBoolean(process.env.VS_RESTORE_AUDIO_TRACK_NAMES_FROM_DB)) {
    const key = '/' + path.substring(options.videoDirectory.length).normalize();
    const row = await options.zidooDb.get<any>('SELECT * FROM VIDEO_INFO WHERE URI = ?', key);

    if (row?.MEDIA_JSON)
      oldAudio = (JSON.parse(row.MEDIA_JSON) as MediaInfo).media.track.filter(t => t['@type'] === 'Audio');
  }

  if (audio?.length > 0) {
    const hasDefault = audio.findIndex(t => t.properties.default_track) >= 0;
    const defaultTrack = audio.find(t => t.properties.default_track) ?? audio[0];
    const languages = new Set<string>();
    const audioLanguages = new Set<string>();
    let audioCommentaries = 0;
    let audioCommentaryIndex = 0;

    primaryLang = getLanguage(audio.find(t => t.properties.flag_original && t.properties.default_track)?.properties);

    if (!primaryLang)
      getLanguage(audio.find(t => t.properties.flag_original)?.properties);

    if (!primaryLang)
      primaryLang = getLanguage(defaultTrack.properties);

    for (const track of audio) {
      languages.add(getLanguage(track.properties));
      audioLanguages.add(getLanguage(track.properties));

      if (track.properties?.flag_commentary)
        ++audioCommentaries;
    }

    for (const track of subtitles ?? [])
      languages.add(getLanguage(track.properties));

    for (let i = 1; i <= audio?.length || 0; ++i) {
      const track = audio[i - 1];
      const tp = track.properties;
      const media = tp.media;
      const lang = getLanguage(tp);
      const language = code2Name[lang] || new Intl.DisplayNames(['en'], { type: 'language' }).of(lang);
      const language2 = new Intl.DisplayNames([lang], { type: 'language' }).of(lang);
      let origName = tp.track_name || '';
      let name = origName;
      const languageStart = ((new RegExp(`^(${regexEscape(language)}|${regexEscape(language2)})\\b`, 'i')).exec(name) ?? [])[1];
      const codecInName = (/\b(AAC|AC-3|DTS-HD MA|DTS-HD HRA|DTS-MA|DTS-HD|DTS|DD EX|E-?AC-?3|MP3|TrueHD)\b/.exec(name) || [])[1];
      const cCount = tp.audio_channels;
      const pl2 = /dolby pl(2|ii)/i.test(name) || (cCount === 2 && defaultTrack.properties.audio_channels > 2 &&
        track.codec === 'AAC' && audio.findIndex(t => t.codec === 'AAC') === i - 1);
      const dolbySurround = /\bDolby Surround\b/.test(media?.Format_Settings_Mode);
      const atmos = /\bJOC\b/i.test(media?.Format) || /\bJOC\b/i.test(media?.Format_AdditionalFeatures) ||
                    /\bAtmos\b/i.test(media?.Format_Commercial_IfAny);
      const codec = getCodec(track);
      const channels = (cCount === 2 && pl2) ? 'Dolby PL2' : (cCount === 2 && dolbySurround) ? 'Dolby Surround' :
        (atmos ? 'Atmos ' : '') + channelString(tp);
      let da = /\bda(\s+([0-9.]+|stereo|mono|atmos))?$/i.test(name);
      let audioDescr = `:${codec}: ${channels}`;

      if (/^[a-z]{2}(-[a-zA-Z]{2})?$/.test(name)) // Blank out names like 'en-GB'.
        name = '';

      if (!da && tp.flag_visual_impaired)
        da = true;

      if (language && !languageStart && (audioLanguages.size > 1 || da))
        audioDescr = language + ' ' + audioDescr;

      audioDescr = audioDescr.replace(/:/g, '');

      let reducedDescr = audioDescr;
      const markedAAC = /\bAAC\b/.test(reducedDescr);

      if (pl2 && markedAAC)
        reducedDescr = reducedDescr.replace('AAC ', '');
      else if (/^(AC-3|DD|E-?AC-?3)$/.test(codec) && reducedDescr.includes(codec))
        reducedDescr = reducedDescr.replace(new RegExp('\\b' + codec + ' '), '');

      if (codecInName && codecInName !== codec)
        name = name.replace(new RegExp('\\b' + regexEscape(codec) + '\\b'), codec);
      else if (oldAudio && oldAudio[i - 1].Title)
        name = oldAudio[i - 1].Title;
      else if (!name)
        name = reducedDescr;

      name = name.replace(/\s*(\((Latinoamericano|Latin America)\)|\[Original])/gi, '');

      if (name === languageStart && (cCount > 2 || pl2)) {
        if (languages.size > 1 || lang !== 'en')
          name = languageStart + ' ' + reducedDescr;
        else
          name = reducedDescr;
      }

      const atmosInName = /\bAtmos\b/i.test(name);

      if (atmos && !atmosInName && name && name !== 'undefined') // Yes, the string literal 'undefined'.
        name = name.replace(/\b([57]\.1\b)/, 'Atmos $1').replace(/^Surround Atmos\b/i, 'Atmos');
      else if (!atmos && atmosInName)
        name = name.replace(/\bAtmos\b/i, '').replace(/\s{2,}/g, ' ').trim();
      else if (name === 'undefined' || (name === audioDescr && audioDescr !== reducedDescr) || (pl2 && markedAAC) ||
               /\bAC-3\b/.test(origName)) {
        if (tp.flag_commentary)
          name = 'Commentary' + (audioCommentaries > 1 ? ' ' + ++audioCommentaryIndex : '');
        else
          name = reducedDescr;
      }

      if (/\b(EAC3|EAC-3|E-AC-3)\b/.test(name || origName))
        name = (name || origName).replace(/\bE-?AC-?3\b/, 'E-AC3');

      if (name && options.laxAudioRenaming !== false &&
          (languageStart + ' ' + name === origName || name.replace(/\bDolby PL2$/, 'AAC Stereo') === origName ||
           name.replace(/^AC-3\b/, 'Surround') === origName))
        name = origName;

      if (/^root\s+/i.test(name))
        name = name.replace(/^root\s+/i, '');
      else if (/^Surround Atmos\b/i.test(name))
        name = name.replace(/^Surround Atmos\b/i, 'Atmos');

      if (/^\d/.test(name))
        name = 'Surround ' + name;

      if (name !== origName) {
        changedNames.push(origName || '(blank)');
        tp.track_name = name;
        editArgs.push('--edit', 'track:a' + i, '--set', 'name=' + name);
      }

      if (i === 1 && !hasDefault && !tp.default_track) {
        editArgs.push('--edit', 'track:a' + i, '--set', 'flag-default=1');
        tp.default_track = true;
      }
      else if (i > 1 && options.mkvTrackReorder) {
        editArgs.push('--edit', 'track:a' + i, '--set', 'flag-default=0');
        tp.default_track = false;
      }

      if (!tp.flag_commentary && /commentary/i.test(origName)) {
        editArgs.push('--edit', 'track:a' + i, '--set', 'flag-commentary=1');
        tp.flag_commentary = true;
      }
      else if (tp.flag_commentary && !/commentary/i.test(origName)) {
        editArgs.push('--edit', 'track:a' + i, '--set', 'flag-commentary=0');
        tp.flag_commentary = false;
      }

      if (!tp.flag_visual_impaired && da) {
        editArgs.push('--edit', 'track:a' + i, '--set', 'flag-visual-impaired=1');
        tp.flag_visual_impaired = true;
      }
      else if (tp.flag_visual_impaired && !da) {
        editArgs.push('--edit', 'track:a' + i, '--set', 'flag-visual-impaired=0');
        tp.flag_visual_impaired = false;
      }

      if (!tp.flag_original && primaryLang === 'en' && lang === 'en') {
        editArgs.push('--edit', 'track:a' + i, '--set', 'flag-original=1');
        tp.flag_original = true;
      }
    }
  }

  if (subtitles?.length > 0) {
    const hasForced = subtitles.findIndex(t => t.properties.forced_track) >= 0;
    let defaultSubs = -1;

    for (let i = 1; i <= subtitles.length; ++i) {
      const track = subtitles[i - 1];
      const tp = track.properties;

      if (tp.default_track) {
        defaultSubs = i;
        break;
      }
    }

    for (let i = 1; i <= subtitles.length; ++i) {
      const track = subtitles[i - 1];
      const tp = track.properties;
      let name = tp.track_name || '';
      let nameIsCode = /^[a-z]{2}$/.test(name);
      const lang = getLanguage(tp);
      const languageName = new Intl.DisplayNames([lang], { type: 'language' }).of(lang);

      if (!name) {
        if (hasForced && tp.forced_track) {
          name = lang;
          nameIsCode = true;
        }
        else {
          name = languageName.substring(0, 1).toUpperCase() + languageName.substring(1);

          if (tp.flag_hearing_impaired && lang === 'en')
            name += ' SDH';
        }
      }

      name = name.replace(/(\s*)\[CC]/, '$1SDH');
      name = name.replace(/\s*(\((Latinoamericano|Latin America)\)|\[Original])/gi, '');

      if (nameIsCode && lang?.length === 2 && name !== lang)
        name = lang;

      if (/^[a-z]{2}.*\bforced\b/.test(name) || /\[(forced|ForcedNarrative)]$/i.test(name)) {
        name = lang;
        nameIsCode = true;
      }

      if (name?.toLowerCase() === 'description' && lang === 'en')
        name = 'English SDH';

      if (name !== (tp.track_name || '')) {
        changedNames.push(tp.track_name);
        tp.track_name = name;
        editArgs.push('--edit', 'track:s' + i, '--set', 'name=' + name);
      }

      // Subtitle tracks named 'en' which are neither default tracks or forced tracks mirror already-burned-in
      //   subtitles, therefore should not be changed to default or forced.
      if (nameIsCode || name === '*') {
        if (!tp.forced_track) {
          editArgs.push('--edit', 'track:s' + i, '--set', 'flag-forced=1');
          tp.forced_track = true;
        }

        if (!tp.default_track && name === primaryLang && (defaultSubs < 0 || allBlankNames)) {
          editArgs.push('--edit', 'track:s' + i, '--set', 'flag-default=1');
          tp.default_track = true;
        }
        else if (tp.default_track && allBlankNames && getLanguage(tp) !== primaryLang) {
          editArgs.push('--edit', 'track:s' + i, '--set', 'flag-default=0');
          tp.default_track = false;
        }

        if (tp.default_track && name !== primaryLang) {
          editArgs.push('--edit', 'track:s' + i, '--set', 'flag-default=0');
          tp.default_track = false;
        }
      }
      else if (tp.default_track && allBlankNames && !tp.forced_track) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-default=0');
        tp.default_track = false;
      }

      if (!tp.flag_commentary && /commentary|info/i.test(name)) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-commentary=1');
        tp.flag_commentary = true;
      }
      else if (tp.flag_commentary && !/commentary|info/i.test(name)) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-commentary=0');
        tp.flag_commentary = false;
      }

      if (!tp.flag_hearing_impaired && /\bSDH\b/.test(name)) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-hearing-impaired=1');
        tp.flag_hearing_impaired = true;
      }
      else if (tp.flag_hearing_impaired && !/\bSDH\b/.test(name)) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-hearing-impaired=0');
        tp.flag_hearing_impaired = false;
      }

      // If flag_original is *explicitly* false, rather than just not set, don't change it.
      if (!tp.flag_original && primaryLang === 'en' && lang === 'en' && name !== '*' &&
          tp.flag_original !== false) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-original=1');
        tp.flag_original = true;
      }
    }
  }

  let lastPath: string;

  if (badDate || (editArgs.length > 1 && (!info.isExtra || options.updateExtraMetadata))) {
    if (badDate)
      console.log('Fixing invalid modification time:', path);

    try {
      if (options.canModify) {
        lastPath = path;

        if (editArgs.length > 1) {
          if (!options.mkvFlagsDryRun) {
            await monitorProcess(spawn('mkvpropedit', editArgs), null, ErrorMode.FAIL_ON_ANY_ERROR);
            info.wasModified = true;
          }

          console.log('mkvpropedit ' + editArgs.map(arg => linuxEscape(arg)).join(' '));

          if (changedNames.length > 0)
            console.log('   Original names:', changedNames.join('; '));
        }
      }
    }
    catch (e) {
      info.error = `Update of ${lastPath} failed: ${e.message}`;
      console.error(info.error);
    }
  }

  if (!info.error && options.mkvTrackReorder) {
    const order = Array.from({ length: info.mkvInfo?.tracks?.length || 0 }, (_, index) => index);
    let orderChanged = false;
    const audioSort: string[] = [];

    for (let i = 1; i <= audio?.length || 0; ++i) {
      const track = audio[i - 1];
      const tp = track.properties;
      const lang = getLanguage(tp);
      let sort = (tp.flag_commentary ? '1' : '0') + (tp.default_track ? '0' : '1');

      switch (lang) {
        case primaryLang: sort += '00'; break;
        case 'en': sort += '01'; break;
        case 'es': sort += '02'; break;
        case 'fr': sort += '03'; break;
        default: sort += lang;
      }

      sort += ':' + i.toString().padStart(2, '0') + ':' + track.id.toString().padStart(2, '0');
      audioSort.push(sort);
    }

    if (audioSort.sort().find((s, i) => toInt(s.substring(5, 7)) !== i + 1)) {
      const base = audio[0].id;

      audioSort.forEach((s, i) => order[i + base] = toInt(s.substring(8)));
      orderChanged = true;
    }

    const subSort: string[] = [];

    for (let i = 1; i <= subtitles?.length || 0; ++i) {
      const track = subtitles[i - 1];
      const tp = track.properties;
      const lang = getLanguage(tp);
      let sort = (tp.forced_track ? '2' : (tp.flag_commentary ? '1' : '0'));

      switch (lang) {
        case primaryLang: sort += '00'; break;
        case 'en': sort += '01'; break;
        case 'es': sort += '02'; break;
        case 'fr': sort += '03'; break;
        default: sort += lang;
      }

      sort += (tp.flag_hearing_impaired ? '1' : '0');
      sort += ':' + i.toString().padStart(2, '0') + ':' + track.id.toString().padStart(2, '0');
      subSort.push(sort);
    }

    if (subSort.sort().find((s, i) => toInt(s.substring(5, 7)) !== i + 1)) {
      const base = subtitles[0].id;

      subSort.forEach((s, i) => order[i + base] = toInt(s.substring(8)));
      orderChanged = true;
    }

    if (orderChanged) {
      console.log(order.join(' '));

      if (options.canModify && !options.mkvFlagsDryRun && !(await reorderTracks(path, order)))
        return false;
      else
        await getMkvWalkInfo(info, path, true);
    }
  }

  if (!info.error && info.wasModified) {
    try {
      const newStats = await safeLstat(path);

      if (options.canModify && !options.mkvFlagsDryRun && newStats) {
        let oldDate = stats.mtime.getTime();

        if (oldDate < Date.now() - ONE_WEEK)
          oldDate += 60000; // Preserve something close to, just a little later than, historical timestamp.
        else
          oldDate = max(newStats.mtime.getTime(), newDate.getTime());

        // Bump modification time to make rsync time match work better.
        newDate = new Date(ceil(oldDate, 1000));
        await utimes(path, newDate, newDate);
      }

      const backups = process.env.VS_VIDEO_BACKUPS ? process.env.VS_VIDEO_BACKUPS.split(',') : [];

      if (options.canModify && !options.mkvTrackReorder && !options.mkvFlagsDryRun &&
          options.mkvFlagsUpdateBackups && stats && backups.length) {
        for (const dir of backups) {
          const backPath = join(dir, path.substring(options.videoDirectory.length));
          const backStats = await safeLstat(backPath);

          if (backStats && backStats.size === stats.size && abs(stats.mtimeMs - backStats.mtimeMs) < 2) {
            editArgs[0] = backPath;
            lastPath = backPath;

            if (editArgs.length > 1 && !options.mkvFlagsDryRun)
              await monitorProcess(spawn('mkvpropedit', editArgs), null, ErrorMode.FAIL_ON_ANY_ERROR);

            await utimes(backPath, newDate, newDate);
            console.log('   also updated:', backPath);
          }
        }
      }
    }
    catch (e) {
      info.error = `Update of ${lastPath} failed: ${e.message}`;
      console.error(info.error);
    }
  }

  if (badDate && info.wasModified) {
    const key = path.substring(options.videoDirectory.length).normalize();
    const row = await options.db.get<any>('SELECT * FROM validation WHERE key = ?', key);

    if (row)
      await options.db.run('UPDATE validation SET mdate = ? WHERE key = ?', newDate.getTime(), key);
  }

  return true;
}

export async function reorderTracks(path: string, order: number[]): Promise<boolean> {
  console.log('    Remuxing %s at %s to reorder tracks', path, new Date().toLocaleString());

  const start = Date.now();
  const backupPath = path.replace(/\.mkv$/i, '[zni].bak.mkv');
  const updatePath = path.replace(/\.mkv$/i, '[zni].upd.mkv');
  const args = ['-o', updatePath, '--track-order', order.map(n => `0:${n}`).join(),
                path];

  try {
    await safeUnlink(updatePath);
    await monitorProcess(spawn('mkvmerge', args), new ProgressReporter('video-progress', 'Track order remux').report,
                         ErrorMode.DEFAULT, 4096);
    webSocketSend({ type: 'video-progress', data: '' });

    if (!isWindows())
      await monitorProcess(spawn('chmod', ['--reference=' + path, updatePath]), null, ErrorMode.IGNORE_ERRORS);

    await tryThrice(() => rename(path, backupPath));
    await tryThrice(() => rename(updatePath, path));
    await tryThrice(() => safeUnlink(backupPath));
  }
  catch {
    if (await existsAsync(backupPath))
      await tryThrice(() => rename(backupPath, path));

    await tryThrice(() => safeUnlink(updatePath));
    webSocketSend({ type: 'video-progress', data: '' });

    return false;
  }

  const elapsed = Date.now() - start;

  console.log('    Total time remuxing: %s', formatTime(elapsed * 1000000).slice(0, -3));

  return true;
}
