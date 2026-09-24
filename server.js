const express = require('express');
const path = require('path');
const { Innertube } = require('youtubei.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let yt = null;

async function initYt() {
  yt = await Innertube.create({
    cache: new Map(),
  });
  console.log('YouTube.js initialized');
}

// ── 検索 ──
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const results = await yt.search(query, { type: 'video' });
    const videos = results.videos.map(v => ({
      id: v.id,
      title: v.title,
      channel: v.author,
      views: v.views,
      duration: v.duration,
      thumb: v.thumbnails?.[v.thumbnails.length - 1]?.url || ''
    }));
    res.json({ videos });
  } catch (e) {
    console.error('Search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 動画情報 ──
app.post('/api/video', async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  try {
    const info = await yt.getBasicInfo(videoId);
    res.json({
      id: info.id,
      title: info.title,
      author: info.author,
      views: info.views,
      duration: info.duration,
      description: info.description,
      thumb: info.thumbnails?.[info.thumbnails.length - 1]?.url || '',
      related: (info.related || []).map(r => ({
        id: r.id,
        title: r.title,
        channel: r.author,
        views: r.views,
        duration: r.duration,
        thumb: r.thumbnails?.[r.thumbnails.length - 1]?.url || ''
      }))
    });
  } catch (e) {
    console.error('Video info error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ストリームURL取得 ──
app.post('/api/stream', async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  try {
    const streamData = await yt.getStreamingData(videoId, {
      format: 'mp4',
      quality: '360p',
      type: 'videoandaudio'
    });
    if (!streamData?.url) {
      return res.status(404).json({ error: 'No stream URL found' });
    }
    res.json({ url: streamData.url });
  } catch (e) {
    console.error('Stream error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ストリームプロキシ ──
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url || !url.includes('googlevideo.com')) {
    return res.status(400).send('Bad URL');
  }

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
    console.error('Proxy error:', e.message);
    res.status(500).send(e.message);
  }
});

// ── 起動 ──
initYt().then(() => {
  app.listen(PORT, () => console.log(`MyTube running on :${PORT}`));
}).catch(e => {
  console.error('Failed to init YouTube.js:', e.message);
  process.exit(1);
});   
