const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

// VISIONOSクライアント（POトークン不要・直接URL・データセンターIPで最も耐性あり）
const VISIONOS = {
  clientName: 'VISIONOS',
  clientVersion: '1.02',
  deviceMake: 'Apple',
  deviceModel: 'RealityDevice17,1',
  osName: 'visionOS',
  osVersion: '26.5.23O471'
};
const VISIONOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

// WEBクライアント（検索用）
const WEB = {
  clientName: 'WEB',
  clientVersion: '2.20250101.00.00',
  hl: 'ja',
  gl: 'JP'
};

// ── 検索 ──
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const r = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': VISIONOS_UA
      },
      body: JSON.stringify({
        context: { client: WEB },
        query
      })
    });
    const data = await r.json();

    const videos = [];
    function walk(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (obj.videoRenderer) {
        const v = obj.videoRenderer;
        const vid = v.videoId || '';
        videos.push({
          id: vid,
          title: v.title?.runs?.[0]?.text || '',
          channel: v.ownerText?.runs?.[0]?.text || '',
          views: v.viewCountText?.simpleText || v.viewCountText?.runs?.[0]?.text || '',
          duration: v.lengthText?.simpleText || '',
          thumb: v.thumbnail?.thumbnails?.length
            ? v.thumbnail.thumbnails[v.thumbnail.thumbnails.length - 1].url
            : (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '')
        });
      }
      for (const k in obj) {
        if (typeof obj[k] === 'object' && obj[k] !== null) walk(obj[k]);
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

  // クライアントフォールバック: VISIONOS → ANDROID_VR → ANDROID
  const clients = [
    { ...VISIONOS, ua: VISIONOS_UA },
    {
      clientName: 'ANDROID_VR',
      clientVersion: '1.73.21',
      androidSdkVersion: 30,
      hl: 'ja',
      gl: 'JP',
      ua: 'com.google.android.youtube/1.73.21 (Linux; U; Android 11) gzip'
    },
    {
      clientName: 'ANDROID',
      clientVersion: '20.10.38',
      androidSdkVersion: 30,
      hl: 'ja',
      gl: 'JP',
      ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip'
    }
  ];

  let lastError = '';

  for (const client of clients) {
    try {
      const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.ua
        },
        body: JSON.stringify({
          context: { client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            ...(client.androidSdkVersion ? { androidSdkVersion: client.androidSdkVersion } : {}),
            ...(client.deviceMake ? { deviceMake: client.deviceMake, deviceModel: client.deviceModel } : {}),
            ...(client.osName ? { osName: client.osName, osVersion: client.osVersion } : {}),
            hl: 'ja',
            gl: 'JP'
          }},
          videoId,
          contentCheckOk: true,
          racyCheckOk: true
        })
      });

      const data = await r.json();

      if (data.playabilityStatus?.status !== 'OK') {
        lastError = data.playabilityStatus?.reason || data.playabilityStatus?.status || 'unknown';
        console.log(`[${client.clientName}] playability: ${lastError}`);
        continue;
      }

      const vd = data.videoDetails || {};

      // ストリームURL取得
      let streamUrl = null;
      const formats = data.streamingData?.formats || [];
      const adaptive = data.streamingData?.adaptiveFormats || [];

      // 統合ストリーム（動画+音声）: itag 22 > 18 > 最初のもの
      let fmt = formats.find(f => f.itag === 22)
            || formats.find(f => f.itag === 18)
            || formats[0];

      // adaptiveのみの場合: video itag 18
      if (!fmt && adaptive.length > 0) {
        fmt = adaptive.find(f => f.itag === 18) || adaptive[0];
      }

      if (fmt?.url) streamUrl = fmt.url;

      if (!streamUrl) {
        lastError = 'no stream URL in response (formats: ' + formats.length + ', adaptive: ' + adaptive.length + ')';
        console.log(`[${client.clientName}] ${lastError}`);
        continue;
      }

      // 関連動画
      const related = [];
      function walkRelated(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (obj.videoRenderer) {
          const v = obj.videoRenderer;
          const rid = v.videoId || '';
          related.push({
            id: rid,
            title: v.title?.runs?.[0]?.text || '',
            channel: v.ownerText?.runs?.[0]?.text || '',
            views: v.viewCountText?.simpleText || '',
            duration: v.lengthText?.simpleText || '',
            thumb: v.thumbnail?.thumbnails?.length
              ? v.thumbnail.thumbnails[v.thumbnail.thumbnails.length - 1].url
              : (rid ? `https://i.ytimg.com/vi/${rid}/hqdefault.jpg` : '')
          });
        }
        for (const k in obj) {
          if (typeof obj[k] === 'object' && obj[k] !== null) walkRelated(obj[k]);
        }
      }
      walkRelated(data.relatedContents || {});

      console.log(`[${client.clientName}] SUCCESS - stream URL found`);

      res.json({
        id: videoId,
        title: vd.title || '',
        author: vd.author || '',
        views: vd.viewCount ? parseInt(vd.viewCount).toLocaleString('ja') + ' 回視聴' : '',
        description: vd.shortDescription || '',
        duration: vd.lengthSeconds ? formatDur(parseInt(vd.lengthSeconds)) : '',
        thumb: vd.thumbnail?.thumbnails?.length
          ? vd.thumbnail.thumbnails[vd.thumbnail.thumbnails.length - 1].url
          : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        streamUrl,
        related: related.slice(0, 12),
        clientUsed: client.clientName
      });
      return;

    } catch (e) {
      lastError = e.message;
      console.error(`[${client.clientName}] error: ${e.message}`);
    }
  }

  // 全クライアント失敗
  res.status(503).json({
    error: '再生できません。YouTubeがデータセンターIPをブロックしている可能性があります。',
    detail: lastError,
    title: ''
  });
});

// ── ストリームプロキシ ──
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('No URL');

  try {
    // VISIONOSのURLはSafari UAが必要、それ以外はAndroid UA
    const isVisionos = url.includes('expire=') && url.includes('ip=');
    const headers = {
      'User-Agent': VISIONOS_UA
    };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const r = await fetch(url, { headers });

    if (!r.ok && r.status !== 206) {
      console.error('Proxy: stream returned', r.status);
      return res.status(r.status).send('Stream error: HTTP ' + r.status);
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
