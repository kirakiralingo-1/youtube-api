const express = require('express');
const path = require('path');
const app = express();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

app.use(express.static(path.join(__dirname)));

// === トレンド（HTMLスクレイプ） ===
app.get('/api/trending', async (req, res) => {
  try {
    const html = await fetch('https://www.youtube.com/feed/trending?gl=JP&hl=ja', {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ja' }
    }).then(r => r.text());

    const m = html.match(/var ytInitialData = (\{.+?\});<\/script>/s);
    if (!m) return res.json({ items: [] });

    const data = JSON.parse(m[1]);
    const items = [];

    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.videoRenderer) {
        const v = obj.videoRenderer;
        items.push({
          id: v.videoId,
          title: v.title?.runs?.[0]?.text || '',
          channel: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '',
          thumbnail: v.thumbnail?.thumbnails?.at(-1)?.url || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
          views: v.viewCountText?.simpleText || v.viewCountText?.runs?.[0]?.text || '',
          duration: v.lengthText?.simpleText || ''
        });
      }
      if (obj.richItemRenderer) {
        const c = obj.richItemRenderer.content;
        if (c?.videoRenderer) walk(c);
      }
      for (const val of Object.values(obj)) walk(val);
    };
    walk(data);

    res.json({ items: items.slice(0, 50) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === 検索（InnerTube、キー不要） ===
app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';
  try {
    const r = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'ja', gl: 'JP' } },
        query: q
      })
    });
    const d = await r.json();
    const items = [];

    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.videoRenderer) {
        const v = obj.videoRenderer;
        items.push({
          id: v.videoId,
          title: v.title?.runs?.[0]?.text || '',
          channel: v.ownerText?.runs?.[0]?.text || '',
          thumbnail: v.thumbnail?.thumbnails?.at(-1)?.url || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
          views: v.viewCountText?.simpleText || '',
          duration: v.lengthText?.simpleText || ''
        });
      }
      for (const val of Object.values(obj)) walk(val);
    };
    walk(d);

    res.json({ items: items.slice(0, 50) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === ストリームURL取得（ANDROIDクライアント、キー不要） ===
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'ja' } },
        videoId
      })
    });
    const d = await r.json();

    // 進捗形式（MP4直接URL）を優先
    const formats = d.streamingData?.formats || [];
    const adaptive = d.streamingData?.adaptiveFormats || [];

    // 解像度順にソート（高い順）
    const all = [
      ...formats.filter(f => f.url).map(f => ({ ...f, type: 'progressive' })),
      ...adaptive.filter(f => f.url).map(f => ({ ...f, type: 'adaptive' }))
    ].sort((a, b) => (b.height || 0) - (a.height || 0));

    // 最も解像度が高い「動画+音声」のprogressive形式、なければ最高画質のadaptive
    let best = all.find(f => f.type === 'progressive' && f.mimeType?.includes('video'));
    if (!best) best = all.find(f => f.mimeType?.includes('video/'));

    // 音声URL（adaptiveのみの場合）
    let audioUrl = null;
    if (best?.type === 'adaptive') {
      const audio = adaptive.find(f => f.mimeType?.includes('audio') && f.url);
      if (audio) audioUrl = audio.url;
    }

    res.json({
      title: d.videoDetails?.title || '',
      channel: d.videoDetails?.author || '',
      url: best?.url || null,
      audioUrl,
      mimeType: best?.mimeType || '',
      height: best?.height || 0,
      // 全形式（品質切り替え用）
      formats: all.filter(f => f.url).map(f => ({
        itag: f.itag,
        url: f.url,
        mimeType: f.mimeType,
        height: f.height,
        quality: f.qualityLabel || ''
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on :${PORT}`));   
