import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanUniqueWeapons } from '../public/savescan.js';

const CANDIDATE_SAVE_DIRS = [
  path.join(os.homedir(), 'Library/Application Support/RimWorld/Saves'),
  path.join(os.homedir(), '.config/unity3d/Ludeon Studios/RimWorld by Ludeon Studios/Saves'),
  path.join(os.homedir(), 'AppData/LocalLow/Ludeon Studios/RimWorld by Ludeon Studios/Saves'),
];

export async function findSaveDir() {
  if (process.env.RIMWORLD_SAVES) return process.env.RIMWORLD_SAVES;
  for (const d of CANDIDATE_SAVE_DIRS) {
    try {
      await fs.access(d);
      return d;
    } catch {}
  }
  return null;
}

export async function listSaves(dir) {
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.rws'));
  const saves = await Promise.all(names.map(async (file) => {
    const st = await fs.stat(path.join(dir, file));
    return { file, mtime: st.mtime.toISOString(), size: st.size };
  }));
  return saves.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export async function findUniqueWeapons(file, uniqueDefs) {
  return scanUniqueWeapons(await fs.readFile(file, 'utf8'), uniqueDefs);
}
