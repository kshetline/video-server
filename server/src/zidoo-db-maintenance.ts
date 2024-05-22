import * as paths from 'path';
import { AsyncDatabase } from 'promised-sqlite3';
import { existsAsync } from './vs-util';

export async function doZidooDbMaintenance(): Promise<void> {
  const dbPath = process.env.VS_ZIDOO_DB;

  if (!dbPath || !await existsAsync(dbPath))
    return;

  const db = await AsyncDatabase.open(dbPath);
  const rows: any[] = [];
  const missing: number[] = [];

  await db.each('SELECT * FROM VIDEO_INFO', undefined, (row: any) => rows.push({ uri: row.URI, id: row._id }));

  for await (const row of rows) {
    const path = paths.join(process.env.VS_VIDEO_SOURCE, row.uri);

    if (!await existsAsync(path)) {
      console.log('Missing:', path);
      missing.push(row.id);
    }
  }

  console.log(missing.length, 'paths for missing files to remove.');

  for await (const id of missing) {
    await db.run('DELETE FROM VIDEO_INFO WHERE _id = ?', id);
  }

  await db.close();
  console.log('DB clean-up done');
}
