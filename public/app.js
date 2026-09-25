const $ = id => document.getElementById(id);

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  $(`view-${name}`).style.display = '';
}

function formatViews(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n + '';
}

function formatDuration(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}

function makeCard(v) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <img class="thumb" src="${v.videoThumbnails?.[0]?.url || ''}" loading="lazy" alt="">
    <div class="info">
      <div class="title">${v.title || ''}</div>
      <div class="meta">${v.author || ''} · ${formatViews(v.viewCount || 0)}回 · ${v.lengthSeconds ? formatDuration(v.lengthSeconds) : ''}</div>
    </div>`;
  el.onclick = () => watchVideo(v.videoId);
  return el;
}

async function loadTrending() {
  showView('trending');
  const grid = $('trending-grid');
  grid.innerHTML = '<p>読み込み中...</p>';
  try {
    const res = await fetch('/api/trending?region=JP');
    const data = await res.json();
    grid.innerHTML = '';
    (Array.isArray(data) ? data : []).forEach(v => grid.appendChild(makeCard(v)));
  } catch (e) {
    grid.innerHTML = '<p>エラー: Invidiousインスタンスに接続できません。環境変数を確認してください。</p>';
  }
}

async function search() {
  const q = $('searchInput').value.trim();
  if (!q) return;
  showView('search');
  $('search-title').textContent = `"${q}" の検索結果`;
  const grid = $('search-grid');
  grid.innerHTML = '<p>検索中...</p>';
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    grid.innerHTML = '';
    (Array.isArray(data) ? data : []).filter(v => v.type === 'video' || v.videoId).forEach(v => grid.appendChild(makeCard(v)));
  } catch {
    grid.innerHTML = '<p>検索エラー</p>';
  }
}

async function watchVideo(id) {
  showView('watch');
  const player = $('player');
  player.src = `/stream/${id}`;
  player.play().catch(() => {});
  $('video-meta').innerHTML = '<p>読み込み中...</p>';
  try {
    const res = await fetch(`/api/video/${id}`);
    const d = await res.json();
    $('video-meta').innerHTML = `
      <h3>${d.title || ''}</h3>
      <p>${d.author || ''} · ${formatViews(d.viewCount || 0)}回再生 · ${d.publishedText || ''}</p>`;
    // 関連動画
    const rg = $('related-grid');
    rg.innerHTML = '';
    (d.recommendedVideos || []).slice(0, 8).forEach(v => rg.appendChild(makeCard(v)));
  } catch {
    $('video-meta').innerHTML = '<p>動画情報を取得できませんでした</p>';
  }
}

// Init
$('searchBtn').onclick = search;
$('searchInput').onkeydown = e => { if (e.key === 'Enter') search(); };
loadTrending();   
