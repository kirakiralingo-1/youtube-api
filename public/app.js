let player = null;

/* ===== YouTube IFrame API ===== */
function onYouTubeIframeAPIReady() {}

function playVideo(id, title) {
  const overlay = document.getElementById('overlay');
  overlay.classList.remove('hidden');
  document.getElementById('playerTitle').textContent = title;

  if (player) { player.destroy(); player = null; }
  player = new YT.Player('player', {
    videoId: id,
    playerVars: { autoplay: 1, rel: 0 },
    events: { onReady: e => e.target.playVideo() }
  });
}

function closePlayer() {
  document.getElementById('overlay').classList.add('hidden');
  if (player) { player.stopVideo(); player.destroy(); player = null; }
}

document.getElementById('closeBtn').onclick = closePlayer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePlayer(); });

/* ===== 描画 ===== */
function render(videos) {
  const grid = document.getElementById('grid');
  if (!videos.length) { grid.innerHTML = '<p class="empty">結果がありません</p>'; return; }
  grid.innerHTML = '';
  videos.forEach(v => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="thumb">
        <img src="${v.thumbnail}" alt="" loading="lazy"/>
        ${v.duration ? `<span class="dur">${v.duration}</span>` : ''}
      </div>
      <div class="meta">
        <h3>${v.title}</h3>
        <p>${v.channel}${v.views ? ' · ' + v.views : ''}</p>
      </div>`;
    el.onclick = () => playVideo(v.id, v.title);
    grid.appendChild(el);
  });
}

function setLoading() {
  document.getElementById('grid').innerHTML = '<p class="loading">読み込み中…</p>';
}

/* ===== API ===== */
async function loadTrending() {
  setLoading();
  try {
    const r = await fetch('/api/trending');
    const d = await r.json();
    render(Array.isArray(d) ? d : []);
  } catch { document.getElementById('grid').innerHTML = '<p class="empty">エラー</p>'; }
}

async function doSearch() {
  const q = document.getElementById('q').value.trim();
  if (!q) return;
  switchTab('search');
  setLoading();
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    render(Array.isArray(d) ? d : []);
  } catch { document.getElementById('grid').innerHTML = '<p class="empty">エラー</p>'; }
}

/* ===== タブ ===== */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    switchTab(btn.dataset.tab);
    if (btn.dataset.tab === 'trending') loadTrending();
  };
});

document.getElementById('searchBtn').onclick = doSearch;
document.getElementById('q').onkeydown = e => { if (e.key === 'Enter') doSearch(); };

/* ===== 初期表示 ===== */
loadTrending();   
