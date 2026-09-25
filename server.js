const express = require('express');
const path = require('path');
const { Innertube } = require('youtubei.js');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

// Innertubeインスタンス（初回アクセス時に生成）
let yt = null;
async function getYt() {
  if (!yt) yt = await Innertube.create();
  return yt;
}

// ===== 動画リストをフロントエンド用形式に変換 =====
function formatVideos(videos) {
  return videos.map(v => ({
    id: v.id,
    title: v.title || '',
    channel: v.author || v.channel?.name || '',
    thumbnail: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    views: v.views || v.metadata?.short_view_count_text?.simple_text || v.metadata?.view_count || '',
    published: v.published || v.metadata?.published || '',
    duration: v.duration?.simple_text || (typeof v.duration === 'string' ? v.duration : ''),
  }));
}

// ===== 人気（今週・再生数順） =====
// FEtrendingは廃止済み → 検索APIで代替
app.get('/api/trending', async (req, res) => {
  try {
    const y = await getYt();
    // sp=CAMSAhAB = 今週 + 再生数順
    const data = await y.actions.execute('/search', {
      query: '',
      params: 'CAMSAhAB',
      parse: true
    });
    const videos = data?.contents?.twoColumnSearchResultsRenderer
      ?.primaryContents?.sectionListRenderer?.contents
      ?.flatMap(s => s.itemSectionRenderer?.contents || [])
      ?.map(item => item.videoRenderer || item.lockupViewModel)
      ?.filter(Boolean) || [];

    // videoRenderer形式
    const result = videos
      .filter(v => v.videoId || v.contentId)
      .map(v => {
        if (v.videoId) {
          return {
            id: v.videoId,
            title: v.title?.runs?.map(r => r.text).join('') || '',
            channel: v.ownerText?.runs?.map(r => r.text).join('') || '',
            thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
            views: v.viewCountText?.simpleText || '',
            published: v.publishedTimeText?.simpleText || '',
            duration: v.lengthText?.simpleText || '',
          };
        }
        // lockupViewModel形式
        const id = v.contentId;
        const meta = v.metadata?.lockupMetadataViewModel;
        const title = meta?.title?.content || '';
        const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
        return {
          id, title,
          channel: rows[0]?.metadataParts?.[0]?.text?.content || '',
          thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
          views: rows[1]?.metadataParts?.[0]?.text?.content || '',
          published: '', duration: '',
        };
      });

    res.json(result);
  } catch (e) {
    console.error('Trending error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== 検索 =====
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const y = await getYt();
    const results = await y.search(q);
    res.json(formatVideos(results.videos || []));
  } catch (e) {
    console.error('Search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== ストリームURL取得 =====
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    const y = await getYt();
    const info = await y.getBasicInfo(videoId);

    if (info.playability_status?.status !== 'OK') {
      return res.status(403).json({ error: `playability: ${info.playability_status?.status}` });
    }

    const formats = info.streaming_data?.formats || [];
    const adaptive = info.streaming_data?.adaptive_formats || [];

    // プログレッシブ（音+画1ファイル）: itag 22(720p) > 18(360p)
    let best = formats.find(f => f.itag === 22)
      || formats.find(f => f.itag === 18)
      || formats.find(f => f.mimeType?.includes('mp4'));

    if (best) {
      const url = best.decipher(y.session.player);
      return res.json({
        type: 'progressive',
        url,
        title: info.basic_info?.title || '',
        quality: best.quality_label || best.quality || '',
      });
    }

    // DASH: 画(137=1080p / 136=720p) + 音(140=m4a)
    const video = adaptive.find(f => f.itag === 137)
      || adaptive.find(f => f.itag === 136)
      || adaptive.find(f => f.type?.includes('video') && !f.type?.includes('audio'));
    const audio = adaptive.find(f => f.itag === 140)
      || adaptive.find(f => f.type?.includes('audio'));

    if (video && audio) {
      const videoUrl = video.decipher(y.session.player);
      const audioUrl = audio.decipher(y.session.player);
      return res.json({
        type: 'dash',
        video: videoUrl,
        audio: audioUrl,
        title: info.basic_info?.title || '',
      });
    }

    res.status(404).json({ error: 'no stream found' });
  } catch (e) {
    console.error('Stream error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Listening on ${PORT}`));   
