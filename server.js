const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── YouTube Innertube API プロキシ ──
app.post('/api/player', async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  const body = {
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '20.10.38',
        androidSdkVersion: 30,
        hl: 'ja',
        gl: 'JP'
      }
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true
  };

  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 動画ストリームプロキシ ──
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url || !url.includes('googlevideo.com')) {
    return res.status(400).send('Bad URL');
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36'
    };
    // Range サポート
    if (req.headers.range) headers['Range'] = req.headers.range;

    const r = await fetch(url, { headers });
    const ct = r.headers.get('content-type') || 'video/mp4';
    const cl = r.headers.get('content-length');
    const cr = r.headers.get('content-range');

    res.status(r.status);
    res.set('Content-Type', ct);
    if (cl) res.set('Content-Length', cl);
    if (cr) res.set('Content-Range', cr);
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
    res.status(500).send(e.message);
  }
});

// ── サーチプロキシ ──
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  const body = {
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '20.10.38',
        androidSdkVersion: 30,
        hl: 'ja',
        gl: 'JP'
      }
    },
    query
  };

  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`MyTube running on :${PORT}`));   
