import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSaveDir, listSaves, findUniqueWeapons } from './scripts/saves.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const ROUTES = {
  '/data/gamedata.json': path.join(ROOT, 'data', 'gamedata.json'),
  '/data/descriptions.json': path.join(ROOT, 'data', 'descriptions.json'),
};
const PUBLIC = path.join(ROOT, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function resolvePath(urlPath) {
  if (ROUTES[urlPath]) return ROUTES[urlPath];
  const file = path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath);
  return file.startsWith(PUBLIC + path.sep) ? file : null;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(body));
}

async function uniqueDefs() {
  const data = JSON.parse(await fs.readFile(ROUTES['/data/gamedata.json'], 'utf8'));
  return new Set(data.weapons.filter((w) => w.unique).map((w) => w.defName));
}

const uniquesCache = new Map();

async function handleApi(url, res) {
  const dir = await findSaveDir();
  if (!dir) return sendJson(res, 404, { error: 'RimWorld save folder not found. Set RIMWORLD_SAVES to its path.' });

  if (url.pathname === '/api/saves') return sendJson(res, 200, { dir, saves: await listSaves(dir) });

  if (url.pathname === '/api/saves/uniques') {
    const file = url.searchParams.get('file') ?? '';
    if (path.basename(file) !== file || !file.endsWith('.rws')) return sendJson(res, 400, { error: 'Invalid save file name.' });
    const full = path.join(dir, file);
    const { mtimeMs } = await fs.stat(full);
    const key = `${file}:${mtimeMs}`;
    if (!uniquesCache.has(key)) uniquesCache.set(key, await findUniqueWeapons(full, await uniqueDefs()));
    return sendJson(res, 200, { file, weapons: uniquesCache.get(key) });
  }
  return sendJson(res, 404, { error: 'Unknown endpoint.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const urlPath = decodeURIComponent(url.pathname);
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method === 'GET' && urlPath.startsWith('/api/')) {
    try {
      await handleApi(url, res);
    } catch (err) {
      sendJson(res, err.code === 'ENOENT' ? 404 : 500, { error: err.message });
    }
    return;
  }
  const file = resolvePath(urlPath);
  if (req.method !== 'GET' || !file) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT' && file === ROUTES['/data/gamedata.json']) {
      res.writeHead(500).end('data/gamedata.json missing — run `npm run extract` first.');
    } else {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
    }
  }
});

server.listen(PORT, () => console.log(`RimWorld weapon comparison on http://localhost:${PORT}`));

// Node as PID 1 in a container ignores SIGTERM unless handled, stalling pod shutdown.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
