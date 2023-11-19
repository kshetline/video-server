export enum Cut { NA, THEATRICAL, INT_THEATRICAL, UNRATED, EXTENDED, DIRECTORS, FINAL, SPECIAL_EDITION }
export enum VType {
  ALIAS_COLLECTION = -2, ALIAS = -1,
  FILE = 0, MOVIE, COLLECTION, TV_SHOW, TV_SEASON, TV_EPISODE, TV_COLLECTION
}
export enum LibraryStatus { NOT_STARTED, INITIALIZED, BONUS_MATERIAL_LINKED, ALL_VIDEOS, MEDIA_DETAILS, DONE = 100 }

export interface ServerStatus {
  lastUpdate: string;
  ready: boolean;
  updateProgress: number;
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
  codec?: string;
  cut?: Cut;
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
  isFHD?: boolean;
  isHD?: boolean;
  isHdr?: boolean;
  isSD?: boolean;
  isTV?: boolean;
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
  useSameArtwork?: boolean;
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
  hash: string;
  role: string;
  time_to_expire: number;
}

export interface UserSession {
  name: string;
  role: string;
  expiration: number;
}
