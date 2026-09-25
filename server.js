const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
  'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+417; SOCS=CAI',
};

// ytInitialData をHTMLから抽出
function extractYtData(html) {
  const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*(?:var |<\/script>)/s);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// 複数のレンダラ形式から動画を抽出
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
          thumbnail: v.thumbnail?.thumbnails?.slice(-1)[0]?.url || '',
          views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '',
          published: v.publishedTimeText?.simpleText || '',
          duration: v.lengthText?.simpleText || '',
        });
      }
      // lockupViewModel (新形式)
      if (key === 'lockupViewModel' && val.contentId) {
        const id = val.contentId;
        if (seen.has(id)) continue;
        seen.add(id);
        const meta = val.metadata?.lockupMetadataViewModel;
        const title = meta?.title?.content || '';
        const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
        const channel = rows[0]?.metadataParts?.[0]?.text?.content || '';
        const views = rows[1]?.metadataParts?.[0]?.text?.content || '';
        const thumb = val.thumbnail?.thumbnailViewModel?.thumbnail?.thumbnails?.slice(-1)[0]?.sourceUrl || '';
        videos.push({ id, title, channel, thumbnail: thumb, views, published: '', duration: '' });
      }
      if (val && typeof val === 'object') walk(val);
    }
  }
  walk(data);
  return videos;
}

// 共通fetch
async function fetchYt(url) {
  const r = await fetch(url, { headers: HEADERS });
  const html = await r.text();
  const data = extractYtData(html);
  if (!data) throw new Error('parse failed');
  return collectVideos(data);
}

// トレンド代替：今週・再生数順
app.get('/api/trending', async (req, res) => {
  try {
    const url = 'https://www.youtube.com/results?search_query=&sp=CAMSAhAB';
    res.json(await fetchYt(url));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 検索
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    res.json(await fetchYt(url));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Listening on ${PORT}`));   
