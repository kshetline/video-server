export enum VType { FILE, MOVIE, COLLECTION, TV_SHOW, TV_SEASON, TV_EPISODE }
export enum CollectionStatus { NOT_STARTED, INITIALIZED, BONUS_MATERIAL_LINKED, ALL_VIDEOS, MEDIA_DETAILS, DONE = 100 }

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
  uri: string;
}

export interface CollectionItem {
  id: number;
  parentId: number;
  collectionId: number;
  aggregationId: number;
  type: VType;
  name: string;
  data?: CollectionItem[];

  actors: {
    character: string;
    name: string;
    profilePath: string;
  }[];
  airDate: string;
  aspectRatio?: string;
  audio?: Track[];
  codec: string;
  directors: {
    name: string;
    profilePath: string;
  }[];
  duration?: number;
  episode?: number;
  extras?: string[];
  frameRate?: number;
  genres?: string[];
  is2k?: boolean;
  is3d?: boolean;
  is4k?: boolean;
  isFHD?: boolean;
  isHD?: boolean;
  isHdr?: boolean;
  overview: string;
  releaseDate: string;
  resolution?: string;
  season?: number;
  subtitle?: Track[];
  title?: string;
  uri?: string;
  video?: Track[];
  videoinfo?: VideoInfo;
  voteAverage?: number;
  watched?: boolean;
  year?: number;
}

export interface Aggregation {
  status?: CollectionStatus;
  lastUpdate?: string;

  start?: number;
  count?: number;
  total?: number;
  array?: CollectionItem[];
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
    certification: string;
    homepage: string;
    overview: string;
    posterPath: string;
  }
}
