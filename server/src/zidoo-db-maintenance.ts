import * as paths from 'path';
import { AsyncDatabase } from 'promised-sqlite3';
import { existsAsync } from './vs-util';

export async function doZidooDbMaintenance(): Promise<void> {
  const dbPath = process.env.VS_ZIDOO_DB;

  if (!dbPath || !await existsAsync(dbPath))
    return;

  const db = await AsyncDatabase.open(dbPath);
  const missing: number[] = [];

  await db.each('SELECT * FROM VIDEO_INFO', undefined, async (row: any) => {
    const path = paths.join(process.env.VS_VIDEO_SOURCE, row.URI);

    if (!await existsAsync(path)) {
      console.log('Missing:', path);
      missing.push(row._id);
    }
  });

  console.log(missing.length, 'paths for missing files to remove.');

  for await (const id of missing) {
    await db.run('DELETE FROM VIDEO_INFO WHERE _id = ?', id);
  }

  console.log('DB clean-up done');
  await db.close();
}
