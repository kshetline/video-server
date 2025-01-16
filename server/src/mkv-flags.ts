import { VideoWalkInfo } from './admin-router';
import { AudioTrackProperties, GeneralTrack, GeneralTrackProperties, MediaInfo, MediaTrack, VideoWalkOptionsPlus } from './shared-types';
import { code2Name, lang3to2 } from './lang';
import { toBoolean, toInt } from '@tubular/util';
import { ErrorMode, linuxEscape, monitorProcess } from './process-util';
import { spawn } from 'child_process';
import { safeLstat } from './vs-util';
import { join } from 'path';
import { abs, ceil, max } from '@tubular/math';
import { utimes } from 'fs/promises';

function getLanguage(props: GeneralTrackProperties): string {
  if (!props)
    return '';

  let lang = (props.language_ietf !== 'und' && props.language_ietf) || props.language || props.language_ietf;

  if (lang !== 'und' && lang?.length > 2)
    lang = lang3to2[lang] ?? lang;

  return lang;
}

function getCodec(track: GeneralTrack): string {
  if (!track)
    return '';

  let codec = track.codec || '';

  if (codec === 'DTS-HD Master Audio')
    codec = 'DTS-HD MA';
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

  if (options.zidooDb && toBoolean(process.env.VS_RESTORE_AUDIO_TRACK_NAMES_FROM_DB)) {
    const key = '/' + path.substring(options.videoDirectory.length).normalize();
    const row = await options.zidooDb.get<any>('SELECT * FROM VIDEO_INFO WHERE URI = ?', key);

    if (row?.MEDIA_JSON)
      oldAudio = (JSON.parse(row.MEDIA_JSON) as MediaInfo).media.track.filter(t => t['@type'] === 'Audio');
  }

  if (audio?.length > 0) {
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

    for (const track of subtitles)
      languages.add(getLanguage(track.properties));

    for (let i = 1; i <= audio?.length || 0; ++i) {
      const track = audio[i - 1];
      const tp = track.properties;
      const media = tp.media;
      const lang = getLanguage(tp);
      const language = code2Name[lang];
      let name = tp.track_name || '';
      const codecInName = (/\b(AAC|AC-3|DTS-HD MA|DTS-HD HRA|DTS-MA|DTS-HD|DTS|DD EX|E-AC3|MP3|TrueHD)\b/.exec(name) || [])[1];
      const atmosInName = /\bAtmos\b/i.test(name) && /\b[57]\.1\b/.test(name);
      let newName: string;
      const cCount = tp.audio_channels;
      const pl2 = /dolby pl(2|ii)/i.test(name) || (cCount === 2 && defaultTrack.properties.audio_channels > 2 &&
        track.codec === 'AAC' && audio.findIndex(t => t.codec === 'AAC') === i - 1);
      const dolbySurround = /\bDolby Surround\b/.test(media?.Format_Settings_Mode);
      const atmos = /\bJOC\b/i.test(media?.Format_AdditionalFeatures) || /\bAtmos\b/i.test(media?.Format_Commercial_IfAny);
      const codec = getCodec(track);
      const channels = (cCount === 2 && pl2) ? 'Dolby PL2' : (cCount === 2 && dolbySurround) ? 'Dolby Surround' :
        (atmos ? 'Atmos ' : '') + channelString(tp);
      let da = /\bda(\s+([0-9.]+|stereo|mono|atmos))?$/i.test(name);
      let audioDescr = `:${codec}: ${channels}`;

      if (!da && tp.flag_visual_impaired)
        da = true;

      if (language && (audioLanguages.size > 1 || da))
        audioDescr = language + ' ' + audioDescr;

      audioDescr = audioDescr.replace(/:/g, '');

      let reducedDescr = audioDescr;
      const markedAAC = /\bAAC\b/.test(reducedDescr);

      if (pl2 && markedAAC)
        reducedDescr = reducedDescr.replace('AAC ', '');
      else if (/^(AC-3|DD|E-AC3)$/.test(codec) && reducedDescr.includes(codec)) {
        reducedDescr = reducedDescr.replace(new RegExp('\\b' + codec + ' '), '');

        if (/^\d/.test(reducedDescr))
          reducedDescr = 'Surround ' + reducedDescr;
      }

      if (codecInName !== codec)
        newName = name.replace(new RegExp('\\b' + codec + '\\b'), codec);
      else if (oldAudio && oldAudio[i - 1].Title)
        newName = oldAudio[i - 1].Title;

      if (atmos && !atmosInName && name && name !== 'undefined') // Yes, the string literal 'undefined'.
        newName = name.replace(/\b([57]\.1\b)/, 'Atmos $1');
      else if (!atmos && atmosInName)
        newName = name.replace(/\bAtmos\b/i, '').replace(/\s{2,}/g, '').trim();
      else if (name === 'undefined' || (name === audioDescr && audioDescr !== reducedDescr) || (pl2 && markedAAC) ||
               /\bAC-3\b/.test(name)) {
        if (tp.flag_commentary)
          newName = 'Commentary' + (audioCommentaries > 1 ? ' ' + ++audioCommentaryIndex : '');
        else
          newName = reducedDescr;
      }

      if (newName && options.laxAudioRenaming !== false &&
          (language + ' ' + newName === name || newName.replace(/\bDolby PL2$/, 'AAC Stereo') === name ||
           newName.replace(/^AC-3\b/, 'Surround') === name))
        newName = undefined;

      if (newName && name !== newName) {
        changedNames.push(name || '(blank)');
        tp.track_name = name = newName;
        editArgs.push('--edit', 'track:a' + i, '--set', 'name=' + name);
      }

      if (!tp.flag_commentary && /commentary/i.test(name)) {
        editArgs.push('--edit', 'track:a' + i, '--set', 'flag-commentary=1');
        tp.flag_commentary = true;
      }
      else if (tp.flag_commentary && !/commentary/i.test(name)) {
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
    let defaultSubs = -1;

    for (let i = 1; i <= subtitles.length; ++i) {
      const track = subtitles[i - 1];
      const tp = track.properties;

      if (tp.enabled_track) {
        defaultSubs = i;
        break;
      }
    }

    for (let i = 1; i <= subtitles.length; ++i) {
      const track = subtitles[i - 1];
      const tp = track.properties;
      let name = tp.track_name;
      const nameIsCode = /^[a-z]{2}$/.test(name);
      const lang = getLanguage(tp);

      if (nameIsCode && lang?.length === 2 && name !== lang) {
        changedNames.push(name);
        tp.track_name = name = lang;
        editArgs.push('--edit', 'track:s' + i, '--set', 'name=' + name);
      }

      // Subtitle tracks named 'en' which are neither default tracks or forced tracks mirror already-burned-in
      //   subtitles, therefore should not be changed to default or forced.
      if (nameIsCode && !(name === 'en' && !tp.default_track && !tp.forced_track)) {
        if (!tp.forced_track) {
          editArgs.push('--edit', 'track:s' + i, '--set', 'flag-forced=1');
          tp.forced_track = true;
        }

        if (!tp.default_track && name === primaryLang && defaultSubs < 0) {
          editArgs.push('--edit', 'track:s' + i, '--set', 'flag-default=1');
          tp.default_track = true;
        }

        if (tp.default_track && name !== primaryLang) {
          editArgs.push('--edit', 'track:s' + i, '--set', 'flag-default=0');
          tp.default_track = false;
        }
      }

      if (!tp.flag_commentary && /commentary|info/i.test(name)) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-commentary=1');
        tp.flag_commentary = true;
      }
      else if (tp.flag_commentary && !/commentary|info/i.test(name)) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-commentary=0');
        tp.flag_commentary = false;
      }

      if (tp.track_name?.toLowerCase() === 'description' && lang === 'en') {
        editArgs.push('--edit', 'track:s' + i, '--set', 'name=English SDH');
        tp.track_name = 'English SDH';
      }

      if (!tp.flag_hearing_impaired && /(\bSDH\b)|\[CC]/.test(tp.track_name)) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-hearing-impaired=1');
        tp.flag_hearing_impaired = true;
      }
      else if (tp.flag_hearing_impaired && !/(\bSDH\b)|\[CC]/.test(tp.track_name)) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-hearing-impaired=0');
        tp.flag_hearing_impaired = false;
      }

      // If flag_original is *explicitly* false, rather than just not set, don't change it.
      if (!tp.flag_original && primaryLang === 'en' && lang === 'en' && tp.flag_original !== false) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-original=1');
        tp.flag_original = true;
      }

      if (lang?.length === 2 && tp.track_name?.length === 2 && tp.track_name !== lang)
        editArgs.push('--edit', 'track:s' + i, '--set', 'name=' + lang);
    }
  }

  if (badDate || (editArgs.length > 1 && (!info.isExtra || options.updateExtraMetadata))) {
    if (badDate)
      console.log('Fixing invalid modification time:', path);

    const backups = process.env.VS_VIDEO_BACKUPS ? process.env.VS_VIDEO_BACKUPS.split(',') : [];
    let lastPath: string;

    try {
      if (options.canModify) {
        lastPath = path;

        if (editArgs.length > 1) {
          if (!options.mkvFlagsDryRun)
            await monitorProcess(spawn('mkvpropedit', editArgs), null, ErrorMode.FAIL_ON_ANY_ERROR);

          console.log('mkvpropedit ' + editArgs.map(arg => linuxEscape(arg)).join(' '));

          if (changedNames.length > 0)
            console.log('   Original names:', changedNames.join('; '));
        }
      }

      info.wasModified = true;

      if (options.canModify && options.mkvFlagsUpdateBackups && stats && backups.length) {
        const newStats = await safeLstat(path);

        if (newStats) {
          // Bump modification time to make rsync time match work better.
          newDate = new Date(ceil(max(newStats.mtime.getTime(), newDate.getTime()), 1000));

          if (!options.mkvFlagsDryRun)
            await utimes(path, newDate, newDate);

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
