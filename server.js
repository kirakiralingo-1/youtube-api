import express from 'express';
import path from 'path';
import { Innertube, Platform } from 'youtubei.js';

const app = express();
app.use(express.static(path.join(path.dirname(new URL(import.meta.url).pathname))));

// ★ 最重要: JSインタプリタを設定（これを忘れるとdecipherが全部失敗する）
Platform.shim.eval = async (data) => {
  return new Function(data.output)();
};

// Innertubeセッション
const yt = await Innertube.create({
  retrieve_player: true
});

// 検索結果の安全なマッピング
function mapVideo(v) {
  const id = v.id || v.videoId || '';
  return {
    id,
    title: v.title || v.name || '',
    channel: typeof v.author === 'object' ? (v.author?.name || '') : (v.author || ''),
    thumbnail: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
    views: typeof v.views === 'object' ? (v.views?.text || '') : (v.views || ''),
    duration: typeof v.duration === 'object' ? (v.duration?.text || '') : (v.duration || '')
  };
}

// === トレンド（人気検索で代替） ===
app.get('/api/trending', async (req, res) => {
  try {
    const data = await yt.search('人気', { type: 'video' });
    const items = (data.videos || []).slice(0, 50).map(mapVideo);
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
    const items = (data.videos || []).slice(0, 50).map(mapVideo);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === ストリームURL取得 ===
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    const info = await yt.getBasicInfo(videoId);
    const title = info.title || '';
    const channel = typeof info.author === 'object' ? (info.author?.name || '') : (info.author || '');

    const sd = info.streaming_data;
    if (!sd) return res.json({ title, channel, directUrl: null, qualities: [], dashVideo: null, dashAudio: null });

    // progressive（動画+音声一体型）
    const progressive = (sd.formats || [])
      .filter(f => f.has_video && f.has_audio)
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    let qualities = [];
    for (const f of progressive) {
      try {
        const url = await f.decipher(yt.session.player);
        if (url) {
          qualities.push({ url, height: f.height, quality: f.quality_label || f.quality || `${f.height}p` });
        }
      } catch (_) {}
    }
    const directUrl = qualities[0]?.url || null;

    // DASH用（progressiveがない場合）
    let dashVideo = null, dashAudio = null;
    const adaptive = sd.adaptive_formats || [];

    const bestV = adaptive.filter(f => f.has_video && !f.has_audio).sort((a,b) => (b.height||0)-(a.height||0))[0];
    const bestA = adaptive.filter(f => f.has_audio && !f.has_video)[0];

    if (bestV) {
      try {
        const url = await bestV.decipher(yt.session.player);
        if (url) dashVideo = { url, mime_type: bestV.mime_type, height: bestV.height, itag: bestV.itag };
      } catch (_) {}
    }
    if (bestA) {
      try {
        const url = await bestA.decipher(yt.session.player);
        if (url) dashAudio = { url, mime_type: bestA.mime_type, itag: bestA.itag };
      } catch (_) {}
    }

    res.json({ title, channel, directUrl, qualities, dashVideo, dashAudio });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Running on :${PORT}`));   
