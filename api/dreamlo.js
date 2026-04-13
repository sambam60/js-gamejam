/**
 * Same-origin proxy for dreamlo (http-only, no CORS).
 * Query: ?path=PUBLIC_OR_PRIVATE_KEY/pipe | KEY/add/...
 */

const DREAMLO_BASE = 'http://dreamlo.com/lb/';

function isValidPath(path) {
  if (!path || path.length > 600 || path.includes('..')) return false;
  const segs = path.split('/');
  if (segs.length < 2) return false;
  const key = segs[0];
  if (!/^[a-zA-Z0-9_-]+$/.test(key) || key.length < 8) return false;
  const rest = segs.slice(1).join('/');
  if (rest === 'pipe') return true;
  if (rest.startsWith('add/')) {
    return /^add\/[^/]+\/[0-9]+(?:\/[0-9]+)?$/.test(rest);
  }
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).end('Method Not Allowed');
  }

  const path = typeof req.query.path === 'string' ? req.query.path.trim() : '';
  if (!isValidPath(path)) {
    return res.status(400).end('Invalid path');
  }

  const target = DREAMLO_BASE + path;
  try {
    const r = await fetch(target, {
      cache: 'no-store',
      headers: { Accept: 'text/plain,*/*' },
    });
    const text = await r.text();
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    return res.status(r.status).send(text);
  } catch {
    return res.status(502).end('Bad gateway');
  }
}
