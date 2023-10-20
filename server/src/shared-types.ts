export enum VType { FILE, MOVIE, COLLECTION, TV_SHOW, TV_SEASON, TV_EPISODE }
export enum CollectionStatus { NOT_STARTED, INITIALIZED, ALL_VIDEOS, ALL_DETAILS, ALL_EXTRAS }

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

  aspectRatio?: string;
  audio?: Track[];
  codec: string;
  duration?: number;
  extras?: string[];
  frameRate?: number;
  is2k?: boolean;
  is3d?: boolean;
  is4k?: boolean;
  isFHD?: boolean;
  isHD?: boolean;
  isHdr?: boolean;
  resolution?: string;
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
  lastUpdate?: number;

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
  HDR_Format_Compatibility: string;
  CodeID: string;
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
