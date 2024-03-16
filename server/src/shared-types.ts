export enum VType { FILE = 0, MOVIE, COLLECTION, TV_SHOW, TV_SEASON, TV_EPISODE, TV_COLLECTION }
export enum LibraryStatus { NOT_STARTED, INITIALIZED, BONUS_MATERIAL_LINKED, ALL_VIDEOS, MEDIA_DETAILS, DONE = 100 }

export interface ServerStatus {
  lastUpdate: string;
  localAccess?: boolean;
  ready: boolean;
  processing: boolean;
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
  airDate?: string;
  aliasPosterPath?: string;
  aspectRatio?: string;
  audio?: Track[];
  backdropPath?: string;
  certification?: string
  codec?: string
  cut?: string;
  cutSort?: number;
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
  logo?: string;
  mobileUri?: string;
  originalName?: string;
  overview?: string;
  parent?: LibraryItem;
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
  VideoCount: string;
  AudioCount: string;
  FrameRate: string;
  Title: string;
  Movie: string;
  Format: string;
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

export interface ShowInfo {
  aggregation: {
    name: string;
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
    },
    aggregations: [{
      id: number;
      name: string;
      aggregation: {
        airDate: string;
        episodeNumber: number;
        name: string;
        overview: string;
        seasonNumber: number;
        stillPath: string;
        voteAverage: number;
        uri: string;
      }
    }];
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

interface MediaTrack {
  '@type': string;
  BitDepth?: string;
  Channels?: string;
  Channels_Original?: string;
  ChannelPositions?: string;
  ChannelPositions_Original?: string;
  ChannelLayout?: string;
  ChannelLayout_Original?: string;
  CodecID?: string;
  Encoded_Library?: string;
  DisplayAspectRatio?: string;
  HDR_Format?: string;
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
  errorCount: number;
  extrasBytes: number;
  extrasCount: number;
  miscFileBytes: number;
  miscFileCount: number;
  movieBytes: number;
  movieCountRaw: number;
  movieTitles: Set<string> | string[];
  skippedForAge: number;
  skippedForType: number;
  streamingFileBytes: number;
  streamingFileCount: number;
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
  generateStreaming?: boolean;
  getMetadata?: boolean;
  isStreamingResource?: (file: string) => boolean;
  mkvFlags?: boolean;
  reportStreamingToCallback?: boolean;
  skipExtras?: boolean;
  skipMovies?: boolean;
  skipTV?: boolean;
  updateExtraMetadata?: boolean;
}

export interface VideoWalkOptionsPlus extends VideoWalkOptions {
  streamingDirectory?: string;
  videoDirectory?: string;
}
