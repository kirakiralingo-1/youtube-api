import express from 'express';
import path from 'path';

const app = express();
const __dirname = path.dirname(new URL(import.meta.url).pathname);
app.use(express.static(__dirname));
app.use(express.json());

// Cobalt API（ローカル :9000）を中継
app.post('/api/cobalt', async (req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:9000', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const d = await r.json();
    res.json(d);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 検索（Cobaltは検索非対応なのでInnerTubeで）
app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.json({ items: [] });
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'ja', gl: 'JP' } },
        query: q
      })
    });
    const d = await r.json();
    const items = [];
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.videoRenderer?.videoId) {
        const v = obj.videoRenderer;
        items.push({
          id: v.videoId,
          title: v.title?.runs?.[0]?.text || '',
          channel: v.ownerText?.runs?.[0]?.text || '',
          thumbnail: `https://img.youtube.com/vi/${v.videoId}/maxresdefault.jpg`,
          duration: v.lengthText?.simpleText || ''
        });
      }
      for (const val of Object.values(obj)) if (typeof val === 'object') walk(val);
    };
    walk(d);
    res.json({ items: items.slice(0, 50) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Running on :${PORT}`));   
