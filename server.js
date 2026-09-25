import express from 'express';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const app = express();
const __dirname = path.dirname(new URL(import.meta.url).pathname);
app.use(express.static(__dirname));

async function getFormats(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const { stdout } = await execFileAsync('yt-dlp', [
    '--extractor-args', 'youtube:player_client=mweb',
    '--dump-json', '--no-warnings', '--no-playlist',
    url
  ], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });

  const data = JSON.parse(stdout);
  const formats = data.formats || [];

  const progressive = formats
    .filter(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.url)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  const videoOnly = formats
    .filter(f => f.vcodec !== 'none' && f.acodec === 'none' && f.url)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0];

  const audioOnly = formats
    .filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url)
    .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

  return {
    title: data.title || '',
    channel: data.channel || data.uploader || '',
    directUrl: progressive[0]?.url || null,
    directHeight: progressive[0]?.height || 0,
    qualities: progressive.map(f => ({ url: f.url, height: f.height, quality: `${f.height}p` })),
    dashVideo: videoOnly?.url || null,
    dashAudio: audioOnly?.url || null
  };
}

async function searchVideos(query) {
  const { stdout } = await execFileAsync('yt-dlp', [
    '--flat-playlist', '--dump-json', '--no-warnings',
    `ytsearch20:${query}`
  ], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });

  const lines = stdout.trim().split('\n').filter(Boolean);
  return lines.map(line => {
    try {
      const d = JSON.parse(line);
      const id = d.id || d.video_id || '';
      return {
        id,
        title: d.title || '',
        channel: d.channel || d.uploader || '',
        thumbnail: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
        views: '',
        duration: d.duration_string || ''
      };
    } catch { return null; }
  }).filter(Boolean);
}

app.get('/api/trending', async (req, res) => {
  try {
    const items = await searchVideos('人気 動画');
    res.json({ items });
  } catch (e) {
    console.error('[TRENDING]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.json({ items: [] });
  try {
    const items = await searchVideos(q);
    res.json({ items });
  } catch (e) {
    console.error('[SEARCH]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    const data = await getFormats(videoId);
    res.json(data);
  } catch (e) {
    console.error('[STREAM]', e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Running on :${PORT}`));   
