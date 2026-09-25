const express = require('express');
const path = require('path');
const { Innertube } = require('youtubei.js');
const app = express();

app.use(express.static(path.join(__dirname)));

// Innertubeセッション（1回だけ生成）
const yt = await Innertube.create({
  cache: { static: true },
  generate_session_locally: true
});

// === トレンド ===
app.get('/api/trending', async (req, res) => {
  try {
    const data = await yt.getTrending({ region: 'JP' });
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
  try {
    const data = await yt.search(q, { type: 'video' });
    const items = (data.vid || data.videos || []).slice(0, 50).map(v => ({
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
    const info = await yt.getBasicInfo(videoId, { client: 'WEB' });
    const title = info.title || '';
    const channel = info.author?.name || '';

    // 全形式を署名復号して取得
    const allFormats = [];
    const formats = info.streaming_data?.formats || [];
    const adaptive = info.streaming_data?.adaptive_formats || [];

    for (const f of [...formats, ...adaptive]) {
      try {
        const url = await f.decipher(yt.session.player);
        if (url) {
          allFormats.push({
            itag: f.itag,
            url,
            mimeType: f.mimeType || '',
            height: f.height || 0,
            quality: f.quality || '',
            type: f.type || (f.mimeType?.includes('audio') ? 'audio' : 'video'),
            container: f.container || ''
          });
        }
      } catch (_) { /* 復号失敗はスキップ */ }
    }

    // progressive（動画+音声一体型）を優先
    const progressive = allFormats
      .filter(f => f.type === 'videoandaudio' || f.mimeType?.includes('video/mp4'))
      .sort((a, b) => b.height - a.height);

    // 最高画質のvideo-only + 最高画質のaudio（DASH用）
    const videoOnly = allFormats
      .filter(f => f.type === 'video' && f.mimeType?.includes('video'))
      .sort((a, b) => b.height - a.height);
    const audioOnly = allFormats
      .filter(f => f.type === 'audio')
      .sort((a, b) => (b.mimeType?.includes('mp4a') ? 1 : 0) - (a.mimeType?.includes('mp4a') ? 1 : 0));

    res.json({
      title,
      channel,
      // progressive直接URL（最もシンプル）
      directUrl: progressive[0]?.url || null,
      directHeight: progressive[0]?.height || 0,
      // 品質リスト
      qualities: progressive.map(f => ({
        url: f.url,
        height: f.height,
        quality: f.quality || `${f.height}p`
      })),
      // DASH用（progressiveがない場合）
      dashVideo: videoOnly[0] || null,
      dashAudio: audioOnly[0] || null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on :${PORT}`));   
