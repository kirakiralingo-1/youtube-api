const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const app = express();
const BASE = (process.env.INVIDIOUS_URL || '').replace(/\/+$/, '');

if (!BASE) {
  console.error('FATAL: INVIDIOUS_URL env var is required');
  process.exit(1);
}

app.use(express.static(path.join(__dirname, 'public')));

function ivFetch(path, params = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Promise((resolve, reject) => {
    const proto = url.protocol === 'https:' ? https : http;
    const req = proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// 日本トレンド
app.get('/api/trending', async (req, res) => {
  try {
    const region = req.query.region || 'JP';
    const data = await ivFetch('/api/v1/trending', { region });
    res.json(data);
  } catch { res.status(502).json({ error: 'trending fetch failed' }); }
});

// 検索
app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'q required' });
    const data = await ivFetch('/api/v1/search', { q, type: 'video' });
    res.json(data);
  } catch { res.status(502).json({ error: 'search failed' }); }
});

// 動画情報（local=trueでストリームURLがインスタンス経由になる）
app.get('/api/video/:id', async (req, res) => {
  try {
    const data = await ivFetch(`/api/v1/videos/${req.params.id}`, { local: 'true' });
    res.json(data);
  } catch { res.status(502).json({ error: 'video info failed' }); }
});

// ストリームプロキシ（Range対応）
app.get('/stream/:id', (req, res) => {
  const id = req.params.id;
  const itag = req.query.itag || '';

  ivFetch(`/api/v1/videos/${id}`, { local: 'true' }).then(data => {
    let streamUrl = null;

    if (data.formatStreams?.length) {
      // 優先順位: 18(360p mp4) > 22(720p mp4) > 最先端
      streamUrl = data.formatStreams.find(f => f.itag === itag)?.url
        || data.formatStreams.find(f => f.itag === '22')?.url
        || data.formatStreams.find(f => f.itag === '18')?.url
        || data.formatStreams[0].url;
    }
    if (!streamUrl && data.adaptiveFormats?.length) {
      streamUrl = data.adaptiveFormats.find(f => f.itag === itag)?.url || data.adaptiveFormats[0].url;
    }
    if (!streamUrl) return res.status(404).json({ error: 'no stream' });

    const su = new URL(streamUrl);
    const proto = su.protocol === 'https:' ? https : http;
    const opts = { headers: { 'User-Agent': 'Mozilla/5.0' } };
    if (req.headers.range) opts.headers['Range'] = req.headers.range;

    const pr = proto.get(su, opts, (proxyRes) => {
      res.status(proxyRes.statusCode);
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'video/mp4');
      if (proxyRes.headers['content-range']) res.setHeader('Content-Range', proxyRes.headers['content-range']);
      res.setHeader('Accept-Ranges', 'bytes');
      if (proxyRes.headers['content-length']) res.setHeader('Content-Length', proxyRes.headers['content-length']);
      proxyRes.pipe(res);
    });
    pr.on('error', () => { if (!res.headersSent) res.status(502).json({ error: 'stream error' }); });
  }).catch(() => { if (!res.headersSent) res.status(502).json({ error: 'stream error' }); });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`listening :${PORT}`));   
