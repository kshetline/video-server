import * as paths from 'path';
import { existsAsync } from './vs-util';
import { AsyncDatabase } from 'promised-sqlite3';
import { toBoolean } from '@tubular/util';
import { monitorProcess } from './process-util';
import { spawn } from 'child_process';

export async function doZidooDbMaintenance(): Promise<void> {
  const dbPath = process.env.VS_ZIDOO_DB;

  if (!dbPath || !await existsAsync(dbPath))
    return;

  try {
    const db = await AsyncDatabase.open(dbPath);
    let rows: any[] = [];
    const missing: number[] = [];

    await db.each('SELECT * FROM VIDEO_INFO', undefined, (row: any) => rows.push({ uri: row.URI, id: row._id }));

    for (let i = 0; i < rows.length; ++i) {
      const row = rows[i];
      const path = paths.join(process.env.VS_VIDEO_SOURCE, row.uri);

      if (!await existsAsync(path)) {
        console.log('Missing:', path);
        missing.push(row.id);
        rows[i] = null;
      }
    }

    console.log(missing.length, 'paths for missing files to remove.');

    for await (const id of missing) {
      await db.run('DELETE FROM VIDEO_INFO WHERE _id = ?', id);
    }

    if (toBoolean(process.env.VS_ZIDOO_DB_UPDATE_MI)) {
      rows = rows.filter(row => !!row);

      for (const row of rows) {
        const path = paths.join(process.env.VS_VIDEO_SOURCE, row.uri);

        try { // TODO: Update to getMediainfo()?
          const mediaJson = JSON.stringify(JSON.parse(await monitorProcess(spawn('mediainfo', [path, '--Output=JSON']))), null, 4);

          await db.run('UPDATE VIDEO_INFO SET MEDIA_JSON = ? WHERE _id = ?', mediaJson, row.id);
          console.log('Updated mediainfo for', path);
        }
        catch (e) {
          console.error('Failed to update mediainfo for %s: %s', path, e.message);
        }
      }
    }

    console.log('DB clean-up done');
  }
  catch (e) {
    console.log('doZidooDbMaintenance:');
    console.log(e);
  }
}
