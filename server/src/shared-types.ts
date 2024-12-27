import { AsyncDatabase } from 'promised-sqlite3';

export enum VType { FILE = 0, MOVIE, COLLECTION, TV_SHOW, TV_SEASON, TV_EPISODE, TV_COLLECTION }
export enum LibraryStatus { NOT_STARTED, INITIALIZED, BONUS_MATERIAL_LINKED, ALL_VIDEOS, MEDIA_DETAILS, DONE = 100 }
export enum WatchStatus { WATCHING = 0, UNWATCHED, WATCHED }

export interface ProcessArgs {
  earliest: string;
  fallback: boolean;
  mkvFlags: boolean;
  skipExtras: boolean;
  skipMovies: boolean;
  skipTv: boolean;
  start: string;
  stop: string;
  streaming: boolean;
  validate: boolean;
}

export interface ServerStatus {
  currentOp: string;
  currentFile: string;
  currentVideo: string;
  currentVideoId: number;
  currentVideoPath: string;
  currentVideoPosition: number;
  encodeProgress: string;
  lastUpdate: string;
  localAccess?: boolean;
  ready: boolean;
  playerAvailable: boolean;
  processArgs: ProcessArgs;
  processing: boolean;
  stopPending: boolean;
  updateProgress: number;
  wsPort: number;
}

export interface Track {
  channels?: string;
  codec?: string;
  language?: string;
  name?: string;
}

export interface VideoInfo {
  id: number;
  aggregationId: number;
  name: string;

  duration: number;
  lastWatchTime: number;
  mediaInfo: any;
  playPoint: number;
  uri: string;
}

export interface LibraryItem {
  id: number;
  parentId: number;
  collectionId: number;
  aggregationId: number;
  type: VType;
  name: string;
  data?: LibraryItem[];

  actors?: {
    character: string;
    name: string;
    profilePath: string;
  }[];
  addedTime?: number;
  airDate?: string;
  aliasPosterPath?: string;
  aspectRatio?: string;
  aspectRatioOverride?: string;
  audio?: Track[];
  backdropPath?: string;
  certification?: string
  codec?: string;
  commentaryAudio?: boolean;
  commentaryText?: boolean;
  cut?: string;
  cutSort?: number;
  defaultSubtitles?: boolean;
  directors?: {
    name: string;
    profilePath: string;
  }[];
  duration?: number;
  episode?: number;
  extras?: string[];
  frameRate?: number;
  genres?: string[];
  hide?: boolean;
  homepage?: string;
  is2k?: boolean;
  is3d?: boolean;
  is4k?: boolean;
  isAlias?: boolean;
  isFHD?: boolean;
  isHD?: boolean;
  isHdr?: boolean;
  isLink?: boolean;
  isSD?: boolean;
  isTV?: boolean;
  isTvMovie?: boolean;
  lastUserWatchTime?: number;
  lastWatchTime?: number;
  logo?: string;
  mobileUri?: string;
  originalName?: string;
  overview?: string;
  parent?: LibraryItem;
  position?: number;
  positionUser?: number;
  posterPath?: string;
  ratingTomatoes?: string;
  releaseDate?: string;
  resolution?: string;
  sampleUri?: string;
  season?: number;
  seasonCount?: number;
  shadowUri?: string;
  streamUri?: string;
  subtitle?: Track[];
  tagLine?: string;
  title?: string;
  tvName?: string;
  tvType?: string;
  uri?: string;
  video?: Track[];
  videoinfo?: VideoInfo;
  voteAverage?: number;
  watched?: boolean;
  watchedByUser?: boolean;
  year?: number;
}

export interface VideoLibrary {
  status?: LibraryStatus;
  progress?: number;
  lastUpdate?: string;
  sparse?: boolean;
  mainFileCount?: number;
  bonusFileCount: number;

  start?: number;
  count?: number;
  total?: number;
  array?: LibraryItem[];
}

export interface MediaInfoTrack {
  '@type': string;
  extra?: {
    NumberOfDynamicObjects: string;
  };
  VideoCount: string;
  AudioCount: string;
  FrameRate: string;
  Title: string;
  Movie: string;
  Format: string;
  Format_AdditionalFeatures?: string;
  Format_Commercial_IfAny?: string;
  HDR_Format: string;
  HDR_Format_Compatibility: string;
  CodecID: string;
  Width: string;
  Height: string;
  DisplayAspectRatio: string;
  BitDepth: string;
  Encoded_Library_Name: string;
  Language: string;
  Default: string;
  Forced: string;
  Channels: string;
  ChannelLayout: string;
}

export interface MediaInfo {
  media: {
    track: MediaInfoTrack[];
  };
}

interface ShowAggregation {
  id: number;
  name: string;
  position: number;
  type: number;
  watched: boolean;
  aggregation: {
    addedTime: number;
    airDate: string;
    episodeNumber: number;
    id: number;
    lastWatchTime: number;
    name: string;
    overview: string;
    playPoint: number;
    seasonNumber: number;
    stillPath: string;
    voteAverage: number;
    uri: string;
  };
  aggregations: ShowAggregation[];
}

export interface ShowInfo {
  aggregation: {
    duration: number;
    name: string;
    position: number;
    watched: boolean;
    aggregation: {
      airDate: string;
      backdropPath: string;
      certification: string;
      episodeCount: number;
      homepage: string;
      logo: string; // URL
      name: string;
      overview: string;
      posterPath: string;
      ratingTomatoes: string;
      releaseDate: string;
      seasonNumber: number;
      tagLine: string;
      tvName: string;
      voteAverage: number;
      watched?: boolean;
    },
    aggregations: ShowAggregation[];
  },
  directors: [{
    name: string;
    profilePath: string;
  }],
  actors: [{
    character: string;
    name: string;
    profilePath: string;
  }],
  genres: [{
    name: string;
  }],
  tv: {
    backdropPath: string;
    certification: string;
    homepage: string;
    name: string;
    numberOfSeasons: number;
    overview: string;
    posterPath: string;
    type: string; // Miniseries, etc.
  }
}

export interface User {
  name: string;
  hash?: string;
  role: string;
  time_to_expire: number;
}

export interface UserSession {
  name: string;
  role: string;
  expiration: number;
}

export interface MediaTrack {
  '@type': string;
  BitDepth?: string;
  Channels?: string;
  Channels_Original?: string;
  ChannelPositions?: string;
  ChannelPositions_Original?: string;
  ChannelLayout?: string;
  ChannelLayout_Original?: string;
  CodecID?: string;
  DisplayAspectRatio?: string;
  Duration?: string;
  Encoded_Library?: string;
  Format?: string;
  Format_AdditionalFeatures?: string;
  Format_Commercial_IfAny?: string;
  Format_Settings_Mode?: string;
  HDR_Format?: string;
  HDR_Format_Compatibility?: string;
  Title?: string;
}

export interface MediaWrapper {
  media: {
    track: MediaTrack[];
  }
}

export interface GeneralTrackProperties {
  codec_id: string;
  default_track: boolean;
  enabled_track: boolean;
  flag_commentary: boolean;
  flag_original: boolean;
  forced_track: boolean;
  language: string;
  language_ietf?: string;
  media?: MediaTrack;
  number: number;
  track_name?: string;
  type: string;
  uid: string;
}

export interface AudioTrackProperties extends GeneralTrackProperties {
  audio_channels: number;
  flag_visual_impaired: boolean;
}

export interface SubtitlesTrackProperties extends GeneralTrackProperties {
  flag_hearing_impaired: boolean;
}

export interface VideoTrackProperties extends GeneralTrackProperties {
  aspect?: number;
  display_dimensions: string;
  pixel_dimensions: string;
  stereo_mode?: number;
}

export interface GeneralTrack {
  codec: string;
  id: number;
  properties: GeneralTrackProperties;
  type: string;
}

export interface AudioTrack extends GeneralTrack {
  properties: AudioTrackProperties;
}

export interface SubtitlesTrack extends GeneralTrack {
  properties: SubtitlesTrackProperties;
}

export interface VideoTrack extends GeneralTrack {
  properties: VideoTrackProperties;
}

export type MkvTrack = AudioTrack | SubtitlesTrack | VideoTrack;

export interface MKVInfo {
  chapters?: [{ num_entries: number }];
  container: {
    properties: {
      date_local?: string;
      date_utc?: string;
      duration: number;
      title?: string;
      writing_application?: string;
    }
  };
  tracks: MkvTrack[];
}

export interface VideoStats {
  durations?: Map<string, number>;
  dvdIsoCount: number;
  errorCount: number;
  extrasBytes: number;
  extrasCount: number;
  isoCount: number;
  miscFileBytes: number;
  miscFileCount: number;
  movieBytes: number;
  movieCountRaw: number;
  movieTitles: Set<string> | string[];
  skippedForAge: number;
  skippedForType: number;
  streamingFileBytes: number;
  streamingFileCount: number;
  totalDuration?: number;
  tvBytes: number;
  tvEpisodesRaw: number;
  tvEpisodeTitles: Set<string> | string[];
  tvShowTitles: Set<string> | string[];
  unstreamedTitles: Set<string> | string[];
  videoCount: number;
}

export interface VideoWalkOptions {
  canModify?: boolean;
  checkStreaming?: boolean | string;
  directoryExclude?: (path: string, dir: string, depth: number) => boolean;
  earliest?: Date;
  generateFallbackAudio?: boolean;
  generateStreaming?: boolean;
  getMetadata?: boolean;
  isStreamingResource?: (file: string) => boolean;
  laxAudioRenaming?: boolean;
  mkvFlags?: boolean;
  reportProgress?: boolean;
  reportStreamingToCallback?: boolean;
  skipExtras?: boolean;
  skipMovies?: boolean;
  skipTV?: boolean;
  updateExtraMetadata?: boolean;
  validate?: boolean;
  walkStart?: string;
  walkStartA?: string[];
  walkStop?: string;
  walkStopA?: string[];
}

export interface VideoWalkOptionsPlus extends VideoWalkOptions {
  countsByPath?: Map<string, number>;
  db?: AsyncDatabase;
  fileCount?: number;
  streamingDirectory?: string;
  totalFileCount?: number;
  videoDirectory?: string;
  zidooDb? : AsyncDatabase;
}

export interface PlaybackProgress {
  duration: number;
  hash: string;
  id?: number;
  last_watched?: number;
  offset: number;
  watched?: boolean;
}

export interface PlayStatus {
  status: number;
  msg?: string;
  video?: {
    currentPosition: number;
    duration: number;
    path: string;
    title: string;
  }
}
