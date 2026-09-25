const express = require('express');
const path = require('path');
const app = express();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const BASE = 'https://www.youtube.com/youtubei/v1';

app.use(express.static(path.join(__dirname)));

// 共通: InnerTube POST
async function innertube(endpoint, body) {
  const r = await fetch(`${BASE}/${endpoint}?key=${INNERTUBE_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(body)
  });
  return r.json();
}

// 再帰的に videoRenderer を収集
function collectVideos(obj, items = []) {
  if (!obj || typeof obj !== 'object') return items;
  if (obj.videoRenderer) {
    const v = obj.videoRenderer;
    if (v.videoId) items.push(v);
  }
  if (obj.richItemRenderer?.content?.videoRenderer) {
    collectVideos(obj.richItemRenderer.content, items);
  }
  for (const val of Object.values(obj)) {
    if (typeof val === 'object') collectVideos(val, items);
  }
  return items;
}

function formatVideo(v) {
  const id = v.videoId;
  return {
    id,
    title: v.title?.runs?.[0]?.text || v.title?.simpleText || '',
    channel: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '',
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    views: v.viewCountText?.simpleText || v.viewCountText?.runs?.[0]?.text || '',
    duration: v.lengthText?.simpleText || ''
  };
}

// === ホームフィード（トレンド代替） ===
app.get('/api/trending', async (req, res) => {
  try {
    const d = await innertube('browse', {
      context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'ja', gl: 'JP' } },
      browseId: 'FEwhat_to_watch'
    });
    const raw = collectVideos(d);
    res.json({ items: raw.slice(0, 50).map(formatVideo) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === 検索 ===
app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';
  try {
    const d = await innertube('search', {
      context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'ja', gl: 'JP' } },
      query: q
    });
    const raw = collectVideos(d);
    res.json({ items: raw.slice(0, 50).map(formatVideo) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === ストリーム情報（HLSマニフェスト + 直接URLフォールバック） ===
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    // ANDROIDクライアントでplayer APIを呼び出し
    const d = await innertube('player', {
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '20.10.38',
          androidSdkVersion: 30,
          hl: 'ja',
          gl: 'JP'
        }
      },
      videoId
    });

    const sd = d.streamingData;
    const title = d.videoDetails?.title || '';
    const channel = d.videoDetails?.author || '';

    // 1) HLSマニフェストURL（最も信頼性が高い）
    let hlsUrl = sd?.hls || null;

    // 2) 直接URLを持つprogressive形式（あれば）
    const progressive = (sd?.formats || [])
      .filter(f => f.url && f.mimeType?.includes('video'))
      .sort((a, b) => (b.height || 0) - (a.height || 0));
    let directUrl = progressive[0]?.url || null;

    // 3) adaptive形式の最高画質（HLSがない場合の代替）
    const adaptive = (sd?.adaptiveFormats || [])
      .filter(f => f.url && f.mimeType?.includes('video'))
      .sort((a, b) => (b.height || 0) - (a.height || 0));
    let adaptiveUrl = adaptive[0]?.url || null;

    res.json({
      title,
      channel,
      hlsUrl,
      directUrl,
      adaptiveUrl,
      // 品質リスト（直接URLがある場合）
      qualities: progressive.map(f => ({
        url: f.url,
        height: f.height,
        quality: f.qualityLabel || `${f.height}p`
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on :${PORT}`));   
