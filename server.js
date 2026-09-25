import express from 'express';
import path from 'path';
import { Innertube } from 'youtubei.js';

const app = express();
app.use(express.static(path.join(path.dirname(new URL(import.meta.url).pathname))));

// Innertubeセッション（1回だけ）
const yt = await Innertube.create();

// === トレンド代替（人気検索） ===
app.get('/api/trending', async (req, res) => {
  try {
    const data = await yt.search('人気', { type: 'video' });
    const items = (data.videos || []).slice(0, 50).map(v => ({
      id: v.id,
      title: v.title,
      channel: v.author?.name || '',
      thumbnail: `https://img.youtube.com/vi/${v.id}/maxresdefault.jpg`,
      views: v.views?.text || '',
      duration: v.duration?.text || ''
    }));
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === 検索 ===
app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.json({ items: [] });
  try {
    const data = await yt.search(q, { type: 'video' });
    const items = (data.videos || []).slice(0, 50).map(v => ({
      id: v.id,
      title: v.title,
      channel: v.author?.name || '',
      thumbnail: `https://img.youtube.com/vi/${v.id}/maxresdefault.jpg`,
      views: v.views?.text || '',
      duration: v.duration?.text || ''
    }));
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === ストリームURL取得（署名復号込み） ===
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    const info = await yt.getBasicInfo(videoId);
    const title = info.title || '';
    const channel = info.author?.name || '';

    // progressive（動画+音声一体型）を優先
    const progressive = info.streaming_data?.formats
      ?.filter(f => f.mimeType?.includes('video/mp4'))
      .sort((a, b) => (b.height || 0) - (a.height || 0)) || [];

    let directUrl = null;
    let qualities = [];

    for (const f of progressive) {
      try {
        const url = await f.decipher(yt.session.player);
        if (url) {
          qualities.push({ url, height: f.height, quality: f.quality || `${f.height}p` });
        }
      } catch (_) {}
    }
    directUrl = qualities[0]?.url || null;

    // DASH用（progressiveがない場合）
    let dashVideo = null, dashAudio = null;
    const adaptive = info.streaming_data?.adaptive_formats || [];

    const bestV = adaptive.filter(f => f.mimeType?.includes('video')).sort((a,b) => (b.height||0)-(a.height||0))[0];
    const bestA = adaptive.filter(f => f.mimeType?.includes('audio/mp4'))[0];

    if (bestV) {
      try { dashVideo = { url: await bestV.decipher(yt.session.player), mimeType: bestV.mimeType, height: bestV.height, itag: bestV.itag }; } catch(_){}
    }
    if (bestA) {
      try { dashAudio = { url: await bestA.decipher(yt.session.player), mimeType: bestA.mimeType, itag: bestA.itag }; } catch(_){}
    }

    res.json({ title, channel, directUrl, qualities, dashVideo, dashAudio });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Running on :${PORT}`));   
