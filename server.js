const express = require('express');
const path = require('path');
const { Innertube } = require('youtubei.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let yt = null;

async function initYt() {
  yt = await Innertube.create();
  console.log('Innertube initialized OK');
}

// ── 検索 ──
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const results = await yt.search(query, { type: 'video' });
    const videos = (results.videos || []).map(v => ({
      id: v.id,
      title: v.title || '',
      channel: v.author || '',
      views: v.views || '',
      duration: v.duration || '',
      thumb: (v.thumbnails && v.thumbnails.length > 0)
        ? v.thumbnails[v.thumbnails.length - 1].url
        : ''
    }));
    res.json({ videos });
  } catch (e) {
    console.error('Search error:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ── 動画情報 + ストリームURL ──
app.post('/api/video', async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  try {
    const info = await yt.getBasicInfo(videoId);

    // 動画+音声統合ストリーム（itag 18 = 360p mp4, itag 22 = 720p mp4）
    let streamUrl = null;
    const formats = info.streaming_data?.formats || [];
    const adaptive = info.streaming_data?.adaptiveFormats || [];

    // 統合ストリームを優先
    let fmt = formats.find(f => f.itag === 18) || formats.find(f => f.itag === 22) || formats[0];
    if (!fmt && adaptive.length > 0) {
      // adaptive のみなら video(18) を使う
      fmt = adaptive.find(f => f.itag === 18) || adaptive[0];
    }

    if (fmt) {
      try {
        streamUrl = fmt.decipher(yt.session.player);
      } catch (e) {
        // decipher 失敗時は生のURLを使う
        streamUrl = fmt.url || null;
      }
    }

    const related = (info.related || []).slice(0, 12).map(r => ({
      id: r.id || '',
      title: r.title || '',
      channel: r.author || '',
      views: r.views || '',
      duration: r.duration || '',
      thumb: (r.thumbnails && r.thumbnails.length > 0)
        ? r.thumbnails[r.thumbnails.length - 1].url
        : ''
    }));

    res.json({
      id: info.id || videoId,
      title: info.title || '',
      author: info.author || '',
      views: info.views || '',
      description: info.description || '',
      duration: info.duration || '',
      thumb: (info.thumbnails && info.thumbnails.length > 0)
        ? info.thumbnails[info.thumbnails.length - 1].url
        : '',
      streamUrl: streamUrl,
      related
    });
  } catch (e) {
    console.error('Video error:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ── ストリームプロキシ ──
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('No URL');

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const r = await fetch(url, { headers });
    res.status(r.status);
    res.set('Content-Type', r.headers.get('content-type') || 'video/mp4');
    if (r.headers.get('content-length')) res.set('Content-Length', r.headers.get('content-length'));
    if (r.headers.get('content-range')) res.set('Content-Range', r.headers.get('content-range'));
    res.set('Accept-Ranges', 'bytes');
    res.set('Access-Control-Allow-Origin', '*');

    const reader = r.body.getReader();
    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) return;
      res.write(Buffer.from(value));
      pump();
    };
    pump();
  } catch (e) {
    console.error('Proxy error:', e);
    if (!res.headersSent) res.status(500).send(e.message);
  }
});

initYt().then(() => {
  app.listen(PORT, () => console.log(`MyTube running on :${PORT}`));
}).catch(e => {
  console.error('Failed to init:', e);
  process.exit(1);
});   
