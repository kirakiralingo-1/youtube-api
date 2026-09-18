const http = require('http');
const fs = require('fs');
const path = require('path');
const { Innertube } = require('youtubei.js');

const PORT = process.env.PORT || 3000;
let yt;

async function initYT() {
  yt = await Innertube.create({ lang: 'ja', gl: 'JP' });
  console.log('✅ Innertube ready');
}

async function proxyStream(req, res, streamUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': 'https://www.youtube.com/'
  };
  if (req.headers.range) headers['Range'] = req.headers.range;
  try {
    const upstream = await fetch(streamUrl, { headers });
    res.writeHead(upstream.status === 206 ? 206 : 200, {
      'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
      'Content-Length': upstream.headers.get('content-length') || '',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    });
    const reader = upstream.body.getReader();
    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value)))
          await new Promise(r => res.once('drain', r));
      }
      res.end();
    })().catch(() => res.end());
    req.on('close', () => reader.cancel().catch(() => {}));
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleSearch(res, query) {
  try {
    const results = await yt.search(query, { type: 'video' });
    const data = results.videos.map(v => ({
      id: v.id, title: v.title, channel: v.author,
      views: v.views, duration: v.duration, published: v.ago || '',
      thumbnail: v.thumbnails?.at(-1)?.url || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleVideo(res, videoId) {
  try {
    const info = await yt.getInfo(videoId, { client: 'TV' });
    const vd = info.video_details;
    const format = info.chooseFormat({ quality: '720p', type: 'videoandaudio' });
    let streamUrl = null, proxyUrl = null;
    if (format) {
      streamUrl = format.decipher(yt.session.player);
      proxyUrl = `/api/stream?url=${encodeURIComponent(streamUrl)}`;
    }
    let related = [];
    try {
      const next = await yt.next(videoId);
      related = (next.upNext?.videos || []).map(v => ({
        id: v.id, title: v.title, channel: v.author,
        views: v.views, duration: v.duration,
        thumbnail: v.thumbnails?.at(-1)?.url || ''
      }));
    } catch {}
    const result = {
      id: videoId, title: vd.title, channel: vd.author,
      channelId: vd.channel_id || '', views: vd.views,
      duration: vd.length_seconds, published: vd.publish_date || '',
      description: vd.description || '',
      thumbnail: vd.thumbnails?.at(-1)?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      streamProxy: proxyUrl, streamUrl, related: related.slice(0, 20)
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleChannel(res, channelId) {
  try {
    const channel = await yt.getChannel(channelId);
    const data = {
      name: channel.name, description: channel.description || '',
      subscriberCount: channel.subscriberCount || '',
      videos: (channel.videos || []).map(v => ({
        id: v.id, title: v.title, channel: v.author,
        views: v.views, duration: v.duration, published: v.ago || '',
        thumbnail: v.thumbnails?.at(-1)?.url || ''
      }))
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Range, Content-Type' });
    return res.end();
  }
  try {
    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (p === '/api/search') {
      const q = url.searchParams.get('q');
      if (!q) { res.writeHead(400); return res.end('Missing q'); }
      return await handleSearch(res, q);
    }
    if (p.startsWith('/api/video/')) {
      return await handleVideo(res, p.split('/')[3]);
    }
    if (p.startsWith('/api/channel/')) {
      return await handleChannel(res, p.split('/')[3]);
    }
    if (p === '/api/stream') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) { res.writeHead(400); return res.end('Missing url'); }
      return await proxyStream(req, res, targetUrl);
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

initYT().then(() => {
  server.listen(PORT, () => console.log(`🎬 http://localhost:${PORT}`));
}).catch(e => { console.error(e); process.exit(1); });   
