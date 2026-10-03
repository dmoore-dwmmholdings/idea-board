// Idea Board — local server. Serves ./public and a small JSON API backed by ./data/ideas.json.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'ideas.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 1024 * 1024;

const STAGES = ['spark', 'exploring', 'building', 'shipped', 'archived'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

// ---------- storage ----------

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function save(ideas) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ideas, null, 2) + '\n');
  fs.renameSync(tmp, DATA_FILE);
}

let ideas = load();

// ---------- validation ----------

class BadRequest extends Error {}

function clean(input, { partial }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequest('Body must be a JSON object');
  }
  const out = {};

  if ('title' in input || !partial) {
    if (typeof input.title !== 'string') throw new BadRequest('title is required');
    const title = input.title.trim();
    if (!title) throw new BadRequest('title cannot be empty');
    if (title.length > 120) throw new BadRequest('title must be 120 characters or fewer');
    out.title = title;
  }
  if ('notes' in input) {
    if (typeof input.notes !== 'string') throw new BadRequest('notes must be a string');
    if (input.notes.length > 5000) throw new BadRequest('notes must be 5,000 characters or fewer');
    out.notes = input.notes;
  }
  if ('stage' in input) {
    if (!STAGES.includes(input.stage)) throw new BadRequest(`stage must be one of ${STAGES.join(', ')}`);
    out.stage = input.stage;
  }
  if ('tags' in input) {
    if (!Array.isArray(input.tags) || input.tags.some((t) => typeof t !== 'string')) {
      throw new BadRequest('tags must be an array of strings');
    }
    const tags = [...new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    if (tags.length > 8) throw new BadRequest('at most 8 tags');
    if (tags.some((t) => t.length > 24)) throw new BadRequest('tags must be 24 characters or fewer');
    out.tags = tags;
  }
  if ('starred' in input) {
    if (typeof input.starred !== 'boolean') throw new BadRequest('starred must be true or false');
    out.starred = input.starred;
  }
  return out;
}

// ---------- http helpers ----------

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    return res.end();
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new BadRequest('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new BadRequest('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Forbidden' });

  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// ---------- routes ----------

async function handleApi(req, res, pathname) {
  const match = pathname.match(/^\/api\/ideas(?:\/([\w-]+))?\/?$/);
  if (!match) return send(res, 404, { error: 'Not found' });
  const id = match[1];

  if (!id && req.method === 'GET') return send(res, 200, ideas);

  if (!id && req.method === 'POST') {
    const fields = clean(await readJson(req), { partial: false });
    const now = new Date().toISOString();
    const idea = {
      id: crypto.randomUUID(),
      title: fields.title,
      notes: fields.notes ?? '',
      stage: fields.stage ?? 'spark',
      tags: fields.tags ?? [],
      starred: fields.starred ?? false,
      createdAt: now,
      updatedAt: now,
    };
    ideas.push(idea);
    save(ideas);
    return send(res, 201, idea);
  }

  if (id) {
    const index = ideas.findIndex((i) => i.id === id);
    if (index === -1) return send(res, 404, { error: 'Idea not found' });

    if (req.method === 'GET') return send(res, 200, ideas[index]);

    if (req.method === 'PATCH') {
      const fields = clean(await readJson(req), { partial: true });
      ideas[index] = { ...ideas[index], ...fields, updatedAt: new Date().toISOString() };
      save(ideas);
      return send(res, 200, ideas[index]);
    }

    if (req.method === 'DELETE') {
      ideas.splice(index, 1);
      save(ideas);
      return send(res, 204);
    }
  }

  return send(res, 405, { error: 'Method not allowed' });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || HOST}`);
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    serveStatic(req, res, pathname);
  } catch (err) {
    if (err instanceof BadRequest) return send(res, 400, { error: err.message });
    console.error(err);
    send(res, 500, { error: 'Something went wrong' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Idea Board running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
