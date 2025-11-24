import * as paths from 'path';
import { existsAsync, getRemoteRecursiveDirectory } from './vs-util';
import { AsyncDatabase } from 'promised-sqlite3';
import { toBoolean } from '@tubular/util';
import { getAugmentedMediaInfo } from './settings';
import { basename, dirname, join } from 'path';
import { safeLstat } from './vs-util';
import { hashUri } from './shared-utils';

export async function doZidooDbMaintenance(): Promise<void> {
  let dbPath = process.env.VS_DB_PATH || 'db.sqlite';

  if (toBoolean(process.env.VS_DO_DB_MAINTENANCE) && await existsAsync(dbPath)) {
    const videos = await getRemoteRecursiveDirectory(true);
    const lookup = new Map<string, string>();

    function walkDirs(dirs = videos, basePath = ''): void {
      for (const file of dirs) {
        if (file.isDir)
          walkDirs(file.children, basePath + '/' + file.name);
        else if (/\.(mpd|av\.webm)$/i.test(file.name)) {
          const path = basePath + '/' + file.name;

          lookup.set(hashUri(path), path);
        }
      }
    }

    walkDirs();

    const db = await AsyncDatabase.open(dbPath);
    const tables = ['validation', 'aspects', 'mediainfo', 'watched'];

    for (const table of tables) {
      try {
        const rows: any[] = await db.all(`SELECT * FROM ${table}`);

        for (const row of rows) {
          const field = table === 'watched' ? 'video' : 'key';
          const share = table === 'watched' ? 'streaming' : 'video';
          const key = row[field] as string;
          const uri = (table === 'watched' ? lookup.get(key) : key);
          const path = uri && `/Volumes/${share}` + uri;
          let stats = uri && await safeLstat(path);

          if (!stats) {
            const altUri = uri && join(dirname(key.replace(/\/2K\b/, '')), '_2K_', basename(path));
            const altKey = uri && (table === 'watched' ? hashUri(altUri) : altUri);
            const altPath = uri && `/Volumes/${share}` + altUri;

            stats = uri && await safeLstat(altPath);

            if (!stats) {
              if (altPath)
                console.log('Missing file:\n    ', path, '\n    ', altPath);
              else
                console.log('Missing key:', key);

              await db.run(`DELETE FROM ${table} WHERE ${field} = ?`, key);
            }
            else {
              console.log('UPDATING:', key, '-->', altKey);

              if (table === 'mediainfo')
                await db.run(`DELETE FROM ${table} WHERE ${field} = ?`, key);
              else
                await db.run(`UPDATE ${table} SET ${field} = ? WHERE ${field} = ?`, altKey, key);
            }
          }
        }
      }
      catch (e) {
        console.log('Failed to validate files:', e.message);
      }
    }
  }

  dbPath = process.env.VS_ZIDOO_DB;

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

    for  (const id of missing) {
      await db.run('DELETE FROM VIDEO_INFO WHERE _id = ?', id);
    }

    if (toBoolean(process.env.VS_ZIDOO_DB_UPDATE_MI)) {
      rows = rows.filter(row => !!row);

      for (const row of rows) {
        const path = paths.join(process.env.VS_VIDEO_SOURCE, row.uri);

        try {
          const mediaJson = JSON.stringify(await getAugmentedMediaInfo(path, true));

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
