import paths from 'path';

export const cacheDir = paths.join(process.cwd(), 'cache');
export const thumbnailDir = paths.join(cacheDir, 'thumbnail');
