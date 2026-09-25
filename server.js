import express from 'express';
import path from 'path';
import vm from 'node:vm';
import { Innertube, Platform } from 'youtubei.js';

const app = express();
const __dirname = path.dirname(new URL(import.meta.url).pathname);
app.use(express.static(__dirname));

// ★★★ 最重要: deciphering用JSインタプリタ ★★★
// env パラメータを正しく処理する（ここが前回失敗した原因）
Platform.shim.eval = (data, env) => {
  const names = Object.keys(env || {});
  try {
    if (names.length > 0) {
      // env変数がある場合: vmで安全に実行
      const code = `(function (${names.join(', ')}) { ${data.output} })`;
      const fn = vm.runInNewContext(code, Object.create(null), { timeout: 10000 });
      return fn(...names.map(n => (env || {})[n]));
    } else {
      // env変数がない場合: self-contained
      return new Function(data.output)();
    }
  } catch (e) {
    console.error('[EVAL ERROR]', e.message);
    // fallback
    try {
      return new Function(data.output)();
    } catch (e2) {
      console.error('[EVAL FALLBACK FAILED]', e2.message);
      throw e2;
    }
  }
};

console.log('⏳ Innertube creating...');
const yt = await Innertube.create({ retrieve_player: true });
console.log('✅ Innertube ready. Player STS:', yt.session.player?.sts || 'N/A');

// 安全な文字列化（[object Object] 防止）
function txt(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (val.text) return val.text;
  if (val.runs) return val.runs.map(r => r.text || '').join('');
  if (val.name) return val.name;
  return String(val);
}

function mapVideo(v) {
  const id = v.id || v.videoId || '';
  return {
    id,
    title: txt(v.title),
    channel: txt(v.author?.name || v.channel?.title || v.ownerText || v.author),
    thumbnail: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
    views: txt(v.views),
    duration: txt(v.duration)
  };
}

// === デバッグ用: decipheringが動作するかテスト ===
app.get('/debug', async (req, res) => {
  const videoId = req.query.id || 'dQw4w9WgXcQ';
  const result = { videoId, steps: {} };
  try {
    result.steps['1_getInfo'] = 'calling getInfo...';
    const info = await yt.getInfo(videoId, { client: 'TV' });
    result.steps['1_getInfo'] = `OK - title: ${info.title}, formats: ${info.streaming_data?.formats?.length || 0}, adaptive: ${info.streaming_data?.adaptive_formats?.length || 0}`;

    const f = info.streaming_data?.adaptive_formats?.[0];
    if (f) {
      result.steps['2_decipher'] = 'calling decipher...';
      const url = await f.decipher(yt.session.player);
      result.steps['2_decipher'] = url ? `OK - ${url.substring(0, 80)}...` : 'FAILED - empty URL';
    } else {
      result.steps['2_decipher'] = 'NO FORMATS FOUND';
    }

    result.steps['3_toDash'] = 'calling toDash...';
    const manifest = await info.toDash(url => url);
    result.steps['3_toDash'] = `OK - manifest length: ${manifest.length}`;
  } catch (e) {
    result.error = e.message;
    result.stack = e.stack?.substring(0, 500);
  }
  res.json(result);
});

// === トレンド（人気検索） ===
app.get('/api/trending', async (req, res) => {
  try {
    const data = await yt.search('人気', { type: 'video' });
    const items = (data.videos || []).slice(0, 50).map(mapVideo);
    res.json({ items });
  } catch (e) {
    console.error('[TRENDING ERROR]', e.message);
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
    console.error('[SEARCH ERROR]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// === DASHマニフェスト ===
app.get('/api/manifest/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    console.log(`[MANIFEST] Requesting: ${videoId}`);
    const info = await yt.getInfo(videoId, { client: 'TV' });
    const origin = req.protocol + '://' + req.get('host');

    const manifest = await info.toDash(url => {
      return `${origin}/proxy?url=${encodeURIComponent(url)}`;
    });

    console.log(`[MANIFEST] OK - length: ${manifest.length}`);
    res.set('Content-Type', 'application/dash+xml');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(manifest);
  } catch (e) {
    console.error('[MANIFEST ERROR]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// === ストリームプロキシ ===
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url');

  try {
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (req.headers.range) headers.Range = req.headers.range;

    console.log(`[PROXY] ${req.headers.range || 'FULL'} -> ${targetUrl.substring(0, 60)}...`);
    const upstream = await fetch(targetUrl, { headers });

    if (!upstream.ok) {
      console.error(`[PROXY] Upstream error: ${upstream.status}`);
      return res.status(upstream.status).send('Upstream error');
    }

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
    console.error('[PROXY ERROR]', e.message);
    res.status(502).send(e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Running on :${PORT}`));   
