import express from 'express';
import path from 'path';
import { Innertube, Platform } from 'youtubei.js';

const app = express();
app.use(express.static(path.join(path.dirname(new URL(import.meta.url).pathname))));

// ★ JSインタプリタ（decipher必須）
Platform.shim.eval = async (data) => {
  return new Function(data.output)();
};

// Innertubeセッション
const yt = await Innertube.create({ retrieve_player: true });
console.log('Innertube ready');

// 安全な文字列取得（Textオブジェクト or 文字列両対応）
function txt(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (val.text) return val.text;
  if (val.runs) return val.runs.map(r => r.text || '').join('');
  return String(val);
}

function mapVideo(v) {
  const id = v.id || v.videoId || '';
  return {
    id,
    title: txt(v.title),
    channel: txt(v.author?.name || v.channel?.title || v.ownerText),
    thumbnail: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
    views: txt(v.views),
    duration: txt(v.duration)
  };
}

// === トレンド（人気検索） ===
app.get('/api/trending', async (req, res) => {
  try {
    const data = await yt.search('人気', { type: 'video' });
    const items = (data.videos || []).slice(0, 50).map(mapVideo);
    res.json({ items });
  } catch (e) {
    console.error('trending error:', e);
    res.status(500).json({ error: e.message });
  }
});

// === 検索 ===
app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.json({ items: [] });
  try {
    const data = await yt.search(q, { type: 'video' });
    const items = (data.videos || []).slice(0, 50).map(mapVideo);
    res.json({ items });
  } catch (e) {
    console.error('search error:', e);
    res.status(500).json({ error: e.message });
  }
});

// === DASHマニフェスト取得 ===
app.get('/api/manifest/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    const info = await yt.getInfo(videoId, { client: 'TV' });
    const origin = req.protocol + '://' + req.get('host');

    const manifest = await info.toDash(url => {
      return `${origin}/proxy?url=${encodeURIComponent(url)}`;
    });

    res.set('Content-Type', 'application/dash+xml');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(manifest);
  } catch (e) {
    console.error('manifest error:', e);
    res.status(500).json({ error: e.message });
  }
});

// === ストリームプロキシ（CORS回避 + Range対応） ===
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url');
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(targetUrl, { headers });

    res.set('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
    res.set('Accept-Ranges', 'bytes');
    if (upstream.status === 206) {
      res.status(206);
      res.set('Content-Range', upstream.headers.get('content-range'));
    }
    if (upstream.headers.get('content-length')) {
      res.set('Content-Length', upstream.headers.get('content-length'));
    }

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    console.error('proxy error:', e);
    res.status(502).send(e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Running on :${PORT}`));   
