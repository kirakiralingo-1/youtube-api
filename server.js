const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const BASE = `https://www.youtube.com/youtubei/v1`;

const WEB_CONTEXT = {
  client: { clientName: 'WEB', clientVersion: '2.20240101.01.00', hl: 'ja', gl: 'JP' }
};

const ANDROID_CONTEXT = {
  client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'ja', gl: 'JP' }
};

async function innertube(endpoint, body, context) {
  const r = await fetch(`${BASE}/${endpoint}?key=${INNERTUBE_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, ...body }),
  });
  if (!r.ok) throw new Error(`Innertube ${r.status}`);
  return r.json();
}

// ===== 動画リストからvideos配列を構築 =====
function extractFromRenderer(items) {
  const videos = [];
  const seen = new Set();

  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'videoRenderer' || key === 'gridVideoRenderer' || key === 'compactVideoRenderer') {
        const v = val;
        if (!v.videoId || seen.has(v.videoId)) continue;
        seen.add(v.videoId);
        videos.push({
          id: v.videoId,
          title: v.title?.runs?.map(r => r.text).join('') || v.title?.simpleText || '',
          channel: v.ownerText?.runs?.map(r => r.text).join('') || v.longBylineText?.runs?.map(r => r.text).join('') || '',
          thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
          views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '',
          published: v.publishedTimeText?.simpleText || '',
          duration: v.lengthText?.simpleText || '',
        });
      }
      if (key === 'lockupViewModel' && val.contentId) {
        const id = val.contentId;
        if (seen.has(id)) continue;
        seen.add(id);
        const meta = val.metadata?.lockupMetadataViewModel;
        const title = meta?.title?.content || '';
        const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
        const channel = rows[0]?.metadataParts?.[0]?.text?.content || '';
        const views = rows[1]?.metadataParts?.[0]?.text?.content || '';
        videos.push({ id, title, channel, thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, views, published: '', duration: '' });
      }
      if (val && typeof val === 'object') walk(val);
    }
  }
  walk(items);
  return videos;
}

// ===== トレンド（FEtrending browse） =====
app.get('/api/trending', async (req, res) => {
  try {
    const data = await innertube('browse', { browseId: 'FEtrending' }, WEB_CONTEXT);
    res.json(extractFromRenderer(data.contents));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 検索 =====
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const data = await innertube('search', { query: q }, WEB_CONTEXT);
    res.json(extractFromRenderer(data.contents));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ストリームURL（ANDROIDクライアント → 直接URL取得） =====
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    const data = await innertube('player', { videoId }, ANDROID_CONTEXT);

    const formats = data.streamingData?.formats || [];
    const adaptive = data.streamingData?.adaptiveFormats || [];

    // プログレッシブ（音+画1ファイル）: itag 22(720p) > 18(360p)
    let best = formats.find(f => f.itag === 22 && f.url)
      || formats.find(f => f.itag === 18 && f.url)
      || formats.find(f => f.url && f.mimeType?.includes('mp4'));

    if (best) {
      return res.json({
        type: 'progressive',
        url: best.url,
        title: data.videoDetails?.title || '',
        quality: best.qualityLabel || best.quality || '',
      });
    }

    // DASH: 画(137/136) + 音(140)
    const video = adaptive.find(f => f.itag === 137 && f.url) || adaptive.find(f => f.itag === 136 && f.url);
    const audio = adaptive.find(f => f.itag === 140 && f.url);
    if (video && audio) {
      return res.json({ type: 'dash', video: video.url, audio: audio.url, title: data.videoDetails?.title || '' });
    }

    res.status(404).json({ error: 'no stream found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Listening on ${PORT}`));   
