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
  document.getElementById('grid').innerHTML = '<p class="loading-msg">読み込み中…</p>';
}

/* ===== 再生 ===== */
const videoEl = document.getElementById('videoEl');
const dashVideo = document.getElementById('dashVideo');
const dashAudio = document.getElementById('dashAudio');
const dashWrap = document.getElementById('dashWrap');
const loadingEl = document.getElementById('loading');

async function playVideo(id, title) {
  const overlay = document.getElementById('overlay');
  overlay.classList.remove('hidden');
  document.getElementById('playerTitle').textContent = title;
  loadingEl.style.display = 'flex';
  videoEl.style.display = 'none';
  dashWrap.style.display = 'none';

  try {
    const r = await fetch(`/api/stream/${id}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'stream error');

    loadingEl.style.display = 'none';

    if (data.type === 'progressive') {
      // 音+画が1つのMP4 → 直接 <video> で再生
      videoEl.src = data.url;
      videoEl.style.display = 'block';
      videoEl.play();
    } else if (data.type === 'dash') {
      // DASH: 画と音を別々に同期再生
      dashWrap.style.display = 'block';
      dashVideo.src = data.video;
      dashAudio.src = data.audio;
      dashAudio.muted = false;
      dashVideo.muted = true;
      await Promise.all([
        dashVideo.play().catch(() => {}),
        dashAudio.play().catch(() => {}),
      ]);
      // 同期: 片方が止まったらもう片方も止める
      dashVideo.onended = () => dashAudio.pause();
      dashAudio.onended = () => dashVideo.pause();
    }
  } catch (e) {
    loadingEl.textContent = `エラー: ${e.message}`;
    loadingEl.style.display = 'flex';
  }
}

function closePlayer() {
  document.getElementById('overlay').classList.add('hidden');
  videoEl.pause(); videoEl.src = '';
  dashVideo.pause(); dashVideo.src = '';
  dashAudio.pause(); dashAudio.src = '';
}

document.getElementById('closeBtn').onclick = closePlayer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePlayer(); });

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

loadTrending();   
