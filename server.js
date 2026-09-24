const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

// ── 検索 ──
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const r = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240901.00.00', hl: 'ja', gl: 'JP' } },
        query
      })
    });
    const data = await r.json();

    // videoRenderer を再帰的に収集
    const videos = [];
    function walk(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (obj.videoRenderer) {
        const v = obj.videoRenderer;
        videos.push({
          id: v.videoId || '',
          title: v.title?.runs?.[0]?.text || '',
          channel: v.ownerText?.runs?.[0]?.text || '',
          views: v.viewCountText?.simpleText || v.viewCountText?.runs?.[0]?.text || '',
          duration: v.lengthText?.simpleText || '',
          thumb: v.thumbnail?.thumbnails?.length
            ? v.thumbnail.thumbnails[v.thumbnail.thumbnails.length - 1].url
            : ''
        });
      }
      for (const k in obj) {
        if (typeof obj[k] === 'object') walk(obj[k]);
      }
    }
    walk(data);

    res.json({ videos: videos.slice(0, 40) });
  } catch (e) {
    console.error('Search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 動画情報 + ストリームURL ──
app.post('/api/video', async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  try {
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            androidSdkVersion: 30,
            hl: 'ja',
            gl: 'JP'
          }
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true
      })
    });
    const data = await r.json();

    if (data.playabilityStatus?.status !== 'OK') {
      return res.json({
        error: data.playabilityStatus?.reason || '再生できません',
        title: data.videoDetails?.title || ''
      });
    }

    const vd = data.videoDetails || {};

    // ストリームURL: 統合ストリーム（動画+音声）を優先
    let streamUrl = null;
    const formats = data.streamingData?.formats || [];
    const adaptive = data.streamingData?.adaptiveFormats || [];

    // itag 22 (720p mp4) > itag 18 (360p mp4) > 最初のもの
    let fmt = formats.find(f => f.itag === 22)
          || formats.find(f => f.itag === 18)
          || formats[0]
          || adaptive.find(f => f.itag === 18)
          || adaptive[0];

    if (fmt?.url) streamUrl = fmt.url;

    // 関連動画
    const related = [];
    function walkRelated(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (obj.videoRenderer) {
        const v = obj.videoRenderer;
        related.push({
          id: v.videoId || '',
          title: v.title?.runs?.[0]?.text || '',
          channel: v.ownerText?.runs?.[0]?.text || '',
          views: v.viewCountText?.simpleText || '',
          duration: v.lengthText?.simpleText || '',
          thumb: v.thumbnail?.thumbnails?.length
            ? v.thumbnail.thumbnails[v.thumbnail.thumbnails.length - 1].url
            : ''
        });
      }
      for (const k in obj) {
        if (typeof obj[k] === 'object') walkRelated(obj[k]);
      }
    }
    walkRelated(data.relatedContents || {});

    res.json({
      id: videoId,
      title: vd.title || '',
      author: vd.author || '',
      views: vd.viewCount ? parseInt(vd.viewCount).toLocaleString('ja') + ' 回視聴' : '',
      description: vd.shortDescription || '',
      duration: vd.lengthSeconds ? formatDur(parseInt(vd.lengthSeconds)) : '',
      thumb: vd.thumbnail?.thumbnails?.length
        ? vd.thumbnail.thumbnails[vd.thumbnail.thumbnails.length - 1].url
        : '',
      streamUrl,
      related: related.slice(0, 12)
    });
  } catch (e) {
    console.error('Video error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ストリームプロキシ ──
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('No URL');

  try {
    const headers = {
      'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip'
    };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const r = await fetch(url, { headers });

    if (!r.ok && r.status !== 206) {
      return res.status(r.status).send('Stream error: ' + r.status);
    }

    res.status(r.status);
    res.set('Content-Type', r.headers.get('content-type') || 'video/mp4');
    if (r.headers.get('content-length')) res.set('Content-Length', r.headers.get('content-length'));
    if (r.headers.get('content-range')) res.set('Content-Range', r.headers.get('content-range'));
    res.set('Accept-Ranges', 'bytes');
    res.set('Access-Control-Allow-Origin', '*');

    const reader = r.body.getReader();
    const pump = async () => {
      try {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        res.write(Buffer.from(value));
        pump();
      } catch (e) {
        if (!res.writableEnded) res.end();
      }
    };
    pump();
  } catch (e) {
    console.error('Proxy error:', e.message);
    if (!res.headersSent) res.status(500).send(e.message);
  }
});

function formatDur(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

app.listen(PORT, () => console.log(`MyTube running on :${PORT}`));   
