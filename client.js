const socket = io();
const MAX_BYTES = 1024 * 1024 * 1024;

const state = {
  me: null,
  videos: [],
  users: [],
  currentVideoId: null,
  search: '',
  accountSearch: '',
  accountSort: 'created-desc'
};

const el = {
  authOverlay: document.getElementById('authOverlay'),
  authError: document.getElementById('authError'),
  tabLogin: document.getElementById('tabLogin'),
  tabSignup: document.getElementById('tabSignup'),
  loginForm: document.getElementById('loginForm'),
  signupForm: document.getElementById('signupForm'),
  app: document.getElementById('app'),
  meLabel: document.getElementById('meLabel'),
  logoutBtn: document.getElementById('logoutBtn'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  refreshBtn: document.getElementById('refreshBtn'),
  uploadForm: document.getElementById('uploadForm'),
  videoFile: document.getElementById('videoFile'),
  accountSearch: document.getElementById('accountSearch'),
  accountSort: document.getElementById('accountSort'),
  accountList: document.getElementById('accountList'),
  feedMeta: document.getElementById('feedMeta'),
  videoFeed: document.getElementById('videoFeed'),
  watchTitle: document.getElementById('watchTitle'),
  watchMeta: document.getElementById('watchMeta'),
  watchDesc: document.getElementById('watchDesc'),
  player: document.getElementById('player'),
  loadLatestBtn: document.getElementById('loadLatestBtn'),
  commentForm: document.getElementById('commentForm'),
  commentList: document.getElementById('commentList')
};

function api(url, options = {}) {
  return fetch(url, {
    credentials: 'same-origin',
    headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) },
    ...options
  }).then(async res => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  });
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : 'Unknown';
}

function showError(message = '') {
  el.authError.textContent = message;
}

function showAuth(login = true) {
  el.authOverlay.classList.remove('hidden');
  el.app.classList.add('hidden');
  el.tabLogin.classList.toggle('active', login);
  el.tabSignup.classList.toggle('active', !login);
  el.loginForm.classList.toggle('hidden', !login);
  el.signupForm.classList.toggle('hidden', login);
}

function showApp() {
  el.authOverlay.classList.add('hidden');
  el.app.classList.remove('hidden');
}

function setPasswordVisibility(form, visible) {
  form.querySelectorAll('input[type="password"], input[data-kind="password"]').forEach(input => {
    input.type = visible ? 'text' : 'password';
    input.dataset.kind = 'password';
  });
}

function wirePasswordToggle(form) {
  form.querySelectorAll('input[name="password"], input[name="confirmPassword"]').forEach(input => {
    input.dataset.kind = 'password';
  });
  const checkbox = form.querySelector('.password-visibility');
  checkbox.addEventListener('change', () => setPasswordVisibility(form, checkbox.checked));
}

function usernameBadge(name) {
  return (name || '?').trim().slice(0, 1).toUpperCase();
}

function renderUsers() {
  const search = state.accountSearch.trim().toLowerCase();
  let users = state.users.filter(u => !search || u.username.toLowerCase().includes(search));
  users = [...users].sort((a, b) => {
    switch (state.accountSort) {
      case 'created-asc': return new Date(a.createdAt) - new Date(b.createdAt);
      case 'created-desc': return new Date(b.createdAt) - new Date(a.createdAt);
      case 'name-desc': return b.username.localeCompare(a.username, undefined, { sensitivity: 'base' });
      case 'name-asc':
      default: return a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });
    }
  });

  el.accountList.innerHTML = '';
  if (!users.length) {
    el.accountList.innerHTML = '<div class="empty">No accounts found.</div>';
    return;
  }

  for (const user of users) {
    const card = document.createElement('div');
    card.className = 'account-card';
    card.innerHTML = `
      <div class="account-name">@${user.username} ${user.id === state.me?.id ? '(you)' : ''}</div>
      <div class="account-meta">Created ${fmtDate(user.createdAt)}</div>
    `;
    el.accountList.appendChild(card);
  }
}

function renderVideos() {
  const search = state.search.trim().toLowerCase();
  const videos = state.videos.filter(v => {
    if (!search) return true;
    return [v.title, v.description, v.author?.username || ''].join(' ').toLowerCase().includes(search);
  });

  el.feedMeta.textContent = `${videos.length} upload${videos.length === 1 ? '' : 's'} available`;
  el.videoFeed.innerHTML = '';

  if (!videos.length) {
    el.videoFeed.innerHTML = '<div class="empty">No videos match that search.</div>';
    return;
  }

  for (const video of videos) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.innerHTML = `
      <div class="thumb" data-letter="${usernameBadge(video.title)}"></div>
      <div>
        <div class="video-title">${escapeHtml(video.title)}</div>
        <div class="video-meta">by @${escapeHtml(video.author?.username || 'unknown')} • ${fmtDate(video.createdAt)} • ${(video.size / (1024 * 1024)).toFixed(1)} MB</div>
        <div class="video-desc">${escapeHtml(video.description || 'No description.')}</div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="small-btn" data-open-video="${video.id}">Watch</button>
        </div>
      </div>
    `;
    el.videoFeed.appendChild(card);
  }

  el.videoFeed.querySelectorAll('[data-open-video]').forEach(btn => {
    btn.addEventListener('click', () => loadVideo(btn.dataset.openVideo));
  });
}

function renderCurrent(video) {
  if (!video) {
    el.watchTitle.textContent = 'Select a video';
    el.watchMeta.textContent = 'Pick a video from the feed.';
    el.watchDesc.textContent = '';
    el.player.removeAttribute('src');
    el.player.load();
    el.commentList.innerHTML = '';
    return;
  }

  el.watchTitle.textContent = video.title;
  el.watchMeta.textContent = `by @${video.author?.username || 'unknown'} • ${fmtDate(video.createdAt)} • ${(video.size / (1024 * 1024)).toFixed(1)} MB`;
  el.watchDesc.textContent = video.description || 'No description.';
  el.player.src = `/uploads/${encodeURIComponent(video.filename)}`;
  el.commentList.innerHTML = '';
  if (!video.comments?.length) {
    el.commentList.innerHTML = '<div class="empty">No comments yet.</div>';
    return;
  }
  for (const comment of video.comments) {
    const item = document.createElement('div');
    item.className = 'comment';
    item.innerHTML = `
      <div class="comment-head">
        <div class="comment-user">@${escapeHtml(comment.author?.username || 'unknown')}</div>
        <div class="comment-meta">${fmtDate(comment.createdAt)}</div>
      </div>
      <div class="comment-body">${escapeHtml(comment.text)}</div>
    `;
    el.commentList.appendChild(item);
  }
}

function escapeHtml(text = '') {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function refreshMe() {
  const data = await api('/api/me');
  state.me = data.user;
  el.meLabel.textContent = `Signed in as @${state.me.username}`;
}

async function refreshUsers() {
  const data = await api('/api/users');
  state.users = data.users;
  renderUsers();
}

async function refreshVideos() {
  const data = await api('/api/videos');
  state.videos = data.videos;
  renderVideos();
  if (state.currentVideoId) {
    const current = state.videos.find(v => v.id === state.currentVideoId);
    renderCurrent(current || null);
  }
}

async function loadVideo(id) {
  const data = await api(`/api/videos/${encodeURIComponent(id)}`);
  state.currentVideoId = id;
  renderCurrent(data.video);
}

async function loadLatest() {
  if (!state.videos.length) return;
  await loadVideo(state.videos[0].id);
}

async function bootstrap() {
  try {
    await refreshMe();
    showApp();
    await Promise.all([refreshUsers(), refreshVideos()]);
    if (state.videos.length) await loadVideo(state.videos[0].id);
  } catch {
    showAuth(true);
  }
}

el.tabLogin.addEventListener('click', () => { showError(''); showAuth(true); });
el.tabSignup.addEventListener('click', () => { showError(''); showAuth(false); });

[el.loginForm, el.signupForm].forEach(form => {
  wirePasswordToggle(form);
});

el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const fd = new FormData(el.loginForm);
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: fd.get('username'),
        password: fd.get('password'),
        confirmPassword: fd.get('confirmPassword')
      })
    });
    await bootstrap();
  } catch (err) {
    showError(err.message);
  }
});

el.signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const fd = new FormData(el.signupForm);
  try {
    await api('/api/signup', {
      method: 'POST',
      body: JSON.stringify({
        username: fd.get('username'),
        password: fd.get('password'),
        confirmPassword: fd.get('confirmPassword')
      })
    });
    await bootstrap();
  } catch (err) {
    showError(err.message);
  }
});

el.logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' });
  location.reload();
});

el.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  state.search = el.searchInput.value;
  renderVideos();
});

el.searchInput.addEventListener('input', () => {
  state.search = el.searchInput.value;
  renderVideos();
});

el.accountSearch.addEventListener('input', () => {
  state.accountSearch = el.accountSearch.value;
  renderUsers();
});

el.accountSort.addEventListener('change', () => {
  state.accountSort = el.accountSort.value;
  renderUsers();
});

el.refreshBtn.addEventListener('click', async () => {
  await Promise.all([refreshUsers(), refreshVideos()]);
});

el.loadLatestBtn.addEventListener('click', async () => {
  await loadLatest();
});

el.uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(el.uploadForm);
  const file = el.videoFile.files[0];
  if (!file) return alert('Choose a video file first.');
  if (file.size > MAX_BYTES) return alert('That file is larger than 1 GB.');
  try {
    const upload = new FormData();
    upload.append('title', fd.get('title'));
    upload.append('description', fd.get('description'));
    upload.append('video', file);
    const res = await fetch('/api/upload', { method: 'POST', body: upload, credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    el.uploadForm.reset();
    await refreshVideos();
    await refreshUsers();
    await loadVideo(data.video.id);
  } catch (err) {
    alert(err.message);
  }
});

el.commentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.currentVideoId) return alert('Pick a video first.');
  const fd = new FormData(el.commentForm);
  const comment = String(fd.get('comment') || '').trim();
  if (!comment) return;
  try {
    await api(`/api/videos/${encodeURIComponent(state.currentVideoId)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text: comment })
    });
    el.commentForm.reset();
    await refreshVideos();
    await loadVideo(state.currentVideoId);
  } catch (err) {
    alert(err.message);
  }
});

socket.on('library:update', async () => {
  await Promise.all([refreshUsers(), refreshVideos()]);
});

socket.on('video:changed', async (videoId) => {
  await refreshVideos();
  if (state.currentVideoId === videoId) await loadVideo(videoId);
});

setInterval(() => {
  if (!el.app.classList.contains('hidden')) {
    Promise.all([refreshUsers(), refreshVideos()]).catch(() => {});
  }
}, 15000);

bootstrap();
