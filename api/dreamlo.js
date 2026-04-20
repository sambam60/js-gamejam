/**
 * Same-origin proxy for dreamlo (no CORS from browser).
 * Query: ?path=PUBLIC_OR_PRIVATE_KEY/pipe | KEY/add/...
 *
 * Uses node:http instead of fetch — Undici fetch to plain HTTP often fails on Vercel (502 from catch).
 */

import http from 'node:http';

const DREAMLO_BASE = 'http://dreamlo.com/lb/';
const UPSTREAM_TIMEOUT_MS = 12_000;

function httpGetText(urlString) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Accept: 'text/plain,*/*',
          'User-Agent': 'shapescape-dreamlo-proxy/1',
          Connection: 'close',
        },
        timeout: UPSTREAM_TIMEOUT_MS,
      },
      (incoming) => {
        const chunks = [];
        incoming.on('data', (c) => chunks.push(c));
        incoming.on('end', () => {
          resolve({
            status: incoming.statusCode ?? 502,
            headers: incoming.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        incoming.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('upstream timeout'));
    });
    req.end();
  });
}

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
    const r = await httpGetText(target);
    const ct = r.headers['content-type'];
    if (typeof ct === 'string') res.setHeader('Content-Type', ct);
    return res.status(r.status).send(r.body);
  } catch (err) {
    console.error('[dreamlo proxy]', err?.message || err);
    return res.status(502).end('Bad gateway');
  }
}
