import { VideoWalkInfo } from './admin-router';
import { AudioTrackProperties, GeneralTrack, GeneralTrackProperties, VideoWalkOptionsPlus } from './shared-types';
import { code2Name, lang3to2 } from './lang';
import { toInt } from '@tubular/util';
import { ErrorMode, linuxEscape, monitorProcess } from './process-util';
import { spawn } from 'child_process';

function getLanguage(props: GeneralTrackProperties): string {
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
  let langCount = 0;

  if (audio?.length > 0) {
    const defaultTrack = audio.find(t => t.properties.default_track) ?? audio[0];
    const languages = new Set<string>();

    primaryLang = getLanguage(defaultTrack.properties);

    for (const track of audio)
      languages.add(getLanguage(track.properties));

    for (const track of subtitles)
      languages.add(getLanguage(track.properties));

    langCount = languages.size;

    for (let i = 1; i <= audio?.length || 0; ++i) {
      const track = audio[i - 1];
      const tp = track.properties;
      const lang = getLanguage(tp);
      const language = code2Name[lang];
      const name = tp.track_name || '';
      const pl2 = /dolby pl(2|ii)/i.test(name);
      const codec = getCodec(track);
      const cCount = tp.audio_channels;
      const channels = (cCount === 2 && pl2) ? 'Dolby PL2' : channelString(tp);
      let da = /\bda(\s+([0-9.]+|stereo|mono))?$/i.test(name);
      let audioDescr = `:${codec}: ${channels}`;

      if (!da && tp.flag_visual_impaired)
        da = true;

      if (language && (langCount > 1 || da))
        audioDescr = language + ' ' + audioDescr;

      audioDescr = audioDescr.replace(/:/g, '');

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
    for (let i = 1; i <= subtitles.length; ++i) {
      const track = subtitles[i - 1];
      const tp = track.properties;
      const lang = getLanguage(tp);

      if (!tp.flag_commentary && /commentary|info/i.test(tp.track_name)) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-commentary=1');
        tp.flag_commentary = true;
      }
      else if (tp.flag_commentary && !/commentary|info/i.test(tp.track_name)) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-commentary=0');
        tp.flag_commentary = false;
      }

      if (tp.track_name?.toLowerCase() === 'description' && lang === 'en') {
        editArgs.push('--edit', 'track:s' + i, '--set', 'name=English SDH');
        tp.track_name = 'English SDH';
      }

      if (!tp.flag_hearing_impaired && /\bSDH\b/.test(tp.track_name)) {
        editArgs.push('--edit', 'track:s' + i, '--set', 'flag-hearing-impaired=1');
        tp.flag_hearing_impaired = true;
      }
      else if (tp.flag_hearing_impaired && !/\bSDH\b/.test(tp.track_name)) {
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

  if (editArgs.length > 1 && (!info.isExtra || options.updateExtraMetadata)) {
    try {
      if (options.canModify) {
        await monitorProcess(spawn('mkvpropedit', editArgs), null, ErrorMode.FAIL_ON_ANY_ERROR);
        console.log('mkvpropedit ' + editArgs.map(arg => linuxEscape(arg)).join(' '));
      }

      info.wasModified = true;
    }
    catch (e) {
      info.error = `Update of ${path} failed: ${e.message}`;
      console.error(info.error);
    }
  }

  return true;
}
