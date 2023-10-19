export interface CollectionItem {
  id: number;
  parentId: number;
  collectionId: number;
  aggregationId: number;
  type: number;
  favor: boolean;
  lock: boolean;
  voteAverage: number;
  name: string;
  isBluRay: boolean;
  is3d: boolean;
  is4k: boolean;
  year: number;
  children: CollectionItem[];
}

export interface Collection {
  status: number;
  id: number;
  parentId: number;
  collectionId: number;
  aggregationId: number;
  type: number;
  favor: boolean;
  lock: false,
  voteAverage: number;
  name: string;
  isBluRay: false,
  is3d: false,
  is4k: true,
  year: number;
  size: number;
  data: CollectionItem[];
}

export interface Aggregation {
  id: number;
  parentId: number;
  collectionId: number;
  aggregationId: number;
  type: number;
  favor: boolean;
  lock: false,
  voteAverage: number;
  name: string;
  isBluRay: boolean;
  is3d: boolean;
  is4k: boolean;
  isHdr: boolean;
  isFHD: boolean;
  is2k: boolean;
  isHD: boolean;
  isDvd: boolean;
  year: number;
  duration: number;
  watched: boolean;
  children?: CollectionItem[];
}

export interface Aggregations {
  start: number;
  count: number;
  total: number;
  array: Aggregation[];
}
