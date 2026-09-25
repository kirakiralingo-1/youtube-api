const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+417; SOCS=CAI',
};

// ===== 堅牢なJSON抽出（中括弧カウント方式） =====
function extractJson(html, varName) {
  const marker = `var ${varName} = `;
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) {
    // 空白が異なる場合のフォールバック
    const alt = html.indexOf(`var ${varName}=`);
    if (alt === -1) return null;
    // '=' の直後から開始
    const braceStart = html.indexOf('{', alt);
    if (braceStart === -1) return null;
    return extractByBraces(html, braceStart);
  }
  const braceStart = html.indexOf('{', startIdx + marker.length);
  if (braceStart === -1) return null;
  return extractByBraces(html, braceStart);
}

function extractByBraces(html, start) {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const jsonStr = html.substring(start, i + 1);
        try { return JSON.parse(jsonStr); } catch { return null; }
      }
    }
  }
  return null;
}

// ===== 動画リスト抽出 =====
function collectVideos(data) {
  const videos = [];
  const seen = new Set();

  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'videoRenderer' || key === 'gridVideoRenderer' || key === 'compactVideoRenderer') {
        const v = val;
        const id = v.videoId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        videos.push({
          id,
          title: v.title?.runs?.map(r => r.text).join('') || v.title?.simpleText || '',
          channel: v.ownerText?.runs?.map(r => r.text).join('') || v.longBylineText?.runs?.map(r => r.text).join('') || '',
          thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
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
        videos.push({
          id, title, channel,
          thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
          views, published: '', duration: '',
        });
      }
      if (val && typeof val === 'object') walk(val);
    }
  }
  walk(data);
  return videos;
}

async function fetchYtPage(url) {
  const r = await fetch(url, { headers: HEADERS });
  return r.text();
}

// ===== トレンド（今週・再生数順） =====
app.get('/api/trending', async (req, res) => {
  try {
    const html = await fetchYtPage('https://www.youtube.com/results?search_query=&sp=CAMSAhAB');
    const data = extractJson(html, 'ytInitialData');
    if (!data) return res.status(500).json({ error: 'ytInitialData not found' });
    res.json(collectVideos(data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 検索 =====
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const html = await fetchYtPage(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
    const data = extractJson(html, 'ytInitialData');
    if (!data) return res.status(500).json({ error: 'ytInitialData not found' });
    res.json(collectVideos(data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ストリームURL取得（googlevideo.com） =====
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    const html = await fetchYtPage(`https://www.youtube.com/watch?v=${videoId}`);
    const player = extractJson(html, 'ytInitialPlayerResponse');
    if (!player) return res.status(500).json({ error: 'ytInitialPlayerResponse not found' });

    const formats = player.streamingData?.formats || [];
    const adaptive = player.streamingData?.adaptiveFormats || [];

    // プログレッシブ（音+画1ファイル）: itag 22(720p) > 18(360p)
    let best = formats.find(f => f.itag === 22 && f.url)
      || formats.find(f => f.itag === 18 && f.url)
      || formats.find(f => f.url && f.mimeType?.includes('mp4'));

    if (!best) {
      // DASH: 画(137/136) + 音(140)
      const video = adaptive.find(f => f.itag === 137 && f.url) || adaptive.find(f => f.itag === 136 && f.url);
      const audio = adaptive.find(f => f.itag === 140 && f.url);
      if (video && audio) {
        return res.json({ type: 'dash', video: video.url, audio: audio.url, title: player.videoDetails?.title || '' });
      }
      return res.status(404).json({ error: 'no stream found' });
    }

    res.json({
      type: 'progressive',
      url: best.url,
      title: player.videoDetails?.title || '',
      quality: best.qualityLabel || best.quality || '',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Listening on ${PORT}`));   
