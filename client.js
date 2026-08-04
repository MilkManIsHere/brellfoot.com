const socket = io();
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SECONDS = 20 * 60;

const state = {
  me: null,
  videos: [],
  users: [],
  currentVideoId: null,
  currentVideoSource: '',
  currentPlaybackTime: 0,
  currentPlaybackPaused: true,
  search: '',
  accountSearch: '',
  accountSort: 'created-desc',
  view: 'home'
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
  navLinks: [...document.querySelectorAll('[data-view]')],
  homeView: document.getElementById('homeView'),
  videosView: document.getElementById('videosView'),
  channelsView: document.getElementById('channelsView'),
  uploadView: document.getElementById('uploadView'),
  uploadForm: document.getElementById('uploadForm'),
  videoFile: document.getElementById('videoFile'),
  durationHint: document.getElementById('durationHint'),
  accountSearch: document.getElementById('accountSearch'),
  accountSort: document.getElementById('accountSort'),
  accountList: document.getElementById('accountList'),
  feedMeta: document.getElementById('feedMeta'),
  videoFeed: document.getElementById('videoFeed'),
  watchTitle: document.getElementById('watchTitle'),
  watchMeta: document.getElementById('watchMeta'),
  watchDesc: document.getElementById('watchDesc'),
  player: document.getElementById('player'),
  commentForm: document.getElementById('commentForm'),
  commentList: document.getElementById('commentList')
};

function api(url, options = {}) {
  return fetch(url, {
    credentials: 'same-origin',
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {})
    },
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

function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Unknown length';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function escapeHtml(text = '') {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function usernameBadge(name) {
  return (name || '?').trim().slice(0, 1).toUpperCase();
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

function wirePasswordToggle(form) {
  const checkbox = form.querySelector('.password-visibility');
  const inputs = [...form.querySelectorAll('input[name="password"], input[name="confirmPassword"]')];
  const setVisible = visible => {
    inputs.forEach(input => {
      input.type = visible ? 'text' : 'password';
    });
  };
  checkbox.addEventListener('change', () => setVisible(checkbox.checked));
}

function renderViewTabs() {
  const views = {
    home: el.homeView,
    videos: el.videosView,
    channels: el.channelsView,
    upload: el.uploadView
  };
  Object.entries(views).forEach(([key, node]) => {
    node.classList.toggle('hidden', state.view !== key);
  });
  el.navLinks.forEach(btn => btn.classList.toggle('active', btn.dataset.view === state.view));
}

function setView(view) {
  state.view = view;
  renderViewTabs();
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
    el.accountList.innerHTML = '<div class="empty">No channels found.</div>';
    return;
  }

  for (const user of users) {
    const card = document.createElement('div');
    card.className = 'account-card';
    card.innerHTML = `
      <div class="account-badge">${escapeHtml(usernameBadge(user.username))}</div>
      <div class="account-body">
        <div class="account-name">@${escapeHtml(user.username)}${user.id === state.me?.id ? ' (you)' : ''}</div>
        <div class="account-meta">Created ${fmtDate(user.createdAt)}</div>
      </div>
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
    el.videoFeed.innerHTML = '<div class="empty">No videos yet.</div>';
    return;
  }

  for (const video of videos) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.innerHTML = `
      <div class="thumb" data-letter="${escapeHtml(usernameBadge(video.title))}"></div>
      <div>
        <div class="video-title">${escapeHtml(video.title)}</div>
        <div class="video-meta">by @${escapeHtml(video.author?.username || 'unknown')} • ${fmtDate(video.createdAt)} • ${(video.size / (1024 * 1024)).toFixed(1)} MB • ${fmtDuration(video.duration)}</div>
        <div class="video-desc">${escapeHtml(video.description || 'No description.')}</div>
        <div class="video-actions">
          <button class="small-btn" data-open-video="${video.id}" type="button">Watch</button>
        </div>
      </div>
    `;
    el.videoFeed.appendChild(card);
  }

  el.videoFeed.querySelectorAll('[data-open-video]').forEach(btn => {
    btn.addEventListener('click', () => loadVideo(btn.dataset.openVideo, { forceSeek: true }));
  });
}

function renderCurrent(video, { preservePlayback = false } = {}) {
  const previouslyPlaying = !el.player.paused;
  const keepSource = preservePlayback && video && state.currentVideoSource === video.filename;
  const savedTime = preservePlayback ? state.currentPlaybackTime : 0;

  if (!video) {
    el.watchTitle.textContent = 'Select a video';
    el.watchMeta.textContent = 'Pick a video from the list.';
    el.watchDesc.textContent = '';
    el.player.removeAttribute('src');
    el.player.load();
    el.commentList.innerHTML = '';
    state.currentVideoSource = '';
    return;
  }

  el.watchTitle.textContent = video.title;
  el.watchMeta.textContent = `by @${video.author?.username || 'unknown'} • ${fmtDate(video.createdAt)} • ${(video.size / (1024 * 1024)).toFixed(1)} MB • ${fmtDuration(video.duration)}`;
  el.watchDesc.textContent = video.description || 'No description.';

  const needsSourceChange = !keepSource && state.currentVideoSource !== video.filename;
  if (needsSourceChange) {
    state.currentVideoSource = video.filename;
    el.player.src = `/uploads/${encodeURIComponent(video.filename)}`;
    el.player.load();
  }

  if (!preservePlayback || needsSourceChange) {
    const restoreOnce = () => {
      if (preservePlayback && Number.isFinite(savedTime) && savedTime > 0) {
        try {
          el.player.currentTime = Math.min(savedTime, Math.max(0, el.player.duration || savedTime));
        } catch {}
      }
      if (preservePlayback && previouslyPlaying) {
        el.player.play().catch(() => {});
      }
    };
    el.player.addEventListener('loadedmetadata', restoreOnce, { once: true });
  }

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
    if (current) renderCurrent(current, { preservePlayback: true });
  }
}

async function loadVideo(id, { forceSeek = false } = {}) {
  const data = await api(`/api/videos/${encodeURIComponent(id)}`);
  state.currentVideoId = id;
  renderCurrent(data.video, { preservePlayback: !forceSeek });
}

async function bootstrap() {
  try {
    await refreshMe();
    showApp();
    renderViewTabs();
    await Promise.all([refreshUsers(), refreshVideos()]);
    if (state.videos.length) {
      state.view = 'videos';
      renderViewTabs();
      await loadVideo(state.videos[0].id, { forceSeek: true });
    }
  } catch {
    showAuth(true);
  }
}

function savePlaybackTick() {
  if (!state.currentVideoId) return;
  if (el.player.duration && Number.isFinite(el.player.currentTime)) {
    state.currentPlaybackTime = el.player.currentTime;
    state.currentPlaybackPaused = el.player.paused;
  }
}

el.tabLogin.addEventListener('click', () => { showError(''); showAuth(true); });
el.tabSignup.addEventListener('click', () => { showError(''); showAuth(false); });
[el.loginForm, el.signupForm].forEach(form => wirePasswordToggle(form));

el.navLinks.forEach(btn => {
  btn.addEventListener('click', () => {
    setView(btn.dataset.view);
    if (btn.dataset.view === 'videos' && !state.currentVideoId && state.videos.length) {
      loadVideo(state.videos[0].id, { forceSeek: true }).catch(() => {});
    }
  });
});

el.loginForm.addEventListener('submit', async e => {
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

el.signupForm.addEventListener('submit', async e => {
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

el.searchForm.addEventListener('submit', e => {
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

el.videoFile.addEventListener('change', async () => {
  const file = el.videoFile.files?.[0];
  if (!file) {
    el.durationHint.textContent = 'Choose a video to check its duration before upload.';
    return;
  }
  if (file.size > MAX_BYTES) {
    el.durationHint.textContent = 'This file is too large. The limit is 20 MB.';
    return;
  }

  const url = URL.createObjectURL(file);
  const probe = document.createElement('video');
  probe.preload = 'metadata';
  probe.src = url;
  probe.onloadedmetadata = () => {
    const seconds = probe.duration;
    URL.revokeObjectURL(url);
    if (Number.isFinite(seconds)) {
      el.durationHint.textContent = `Duration: ${fmtDuration(seconds)}. Maximum allowed: 20:00.`;
    } else {
      el.durationHint.textContent = 'Could not read duration. Maximum allowed: 20:00.';
    }
  };
  probe.onerror = () => {
    URL.revokeObjectURL(url);
    el.durationHint.textContent = 'Could not read duration. Maximum allowed: 20:00.';
  };
});

el.uploadForm.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(el.uploadForm);
  const file = fd.get('video');
  if (!(file instanceof File)) return;
  if (file.size > MAX_BYTES) {
    alert('File is larger than 20 MB.');
    return;
  }

  const duration = await new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = url;
    probe.onloadedmetadata = () => {
      const value = probe.duration;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) ? value : null);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
  });

  if (duration != null && duration > MAX_SECONDS) {
    alert('Video must be 20 minutes or shorter.');
    return;
  }

  try {
    const upload = new FormData();
    upload.append('title', fd.get('title'));
    upload.append('description', fd.get('description'));
    upload.append('video', file);
    const res = await fetch('/api/upload', { method: 'POST', body: upload, credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    el.uploadForm.reset();
    el.durationHint.textContent = 'Choose a video to check its duration before upload.';
    await Promise.all([refreshUsers(), refreshVideos()]);
    state.view = 'videos';
    renderViewTabs();
    await loadVideo(data.video.id, { forceSeek: true });
  } catch (err) {
    alert(err.message);
  }
});

el.commentForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!state.currentVideoId) return;
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
    const current = state.videos.find(v => v.id === state.currentVideoId);
    if (current) renderCurrent(current, { preservePlayback: true });
  } catch (err) {
    alert(err.message);
  }
});

el.player.addEventListener('timeupdate', savePlaybackTick);
el.player.addEventListener('pause', savePlaybackTick);
el.player.addEventListener('play', savePlaybackTick);
el.player.addEventListener('seeking', savePlaybackTick);
el.player.addEventListener('seeked', savePlaybackTick);
el.player.addEventListener('ended', savePlaybackTick);

socket.on('library:update', async () => {
  const currentId = state.currentVideoId;
  await Promise.all([refreshUsers(), refreshVideos()]);
  if (currentId && state.currentVideoId === currentId) {
    const current = state.videos.find(v => v.id === currentId);
    if (current) renderCurrent(current, { preservePlayback: true });
  }
});

socket.on('video:changed', async videoId => {
  await refreshVideos();
  if (state.currentVideoId === videoId) {
    const current = state.videos.find(v => v.id === videoId);
    if (current) renderCurrent(current, { preservePlayback: true });
  }
});

setInterval(() => {
  if (!el.app.classList.contains('hidden')) {
    Promise.all([refreshUsers(), refreshVideos()]).catch(() => {});
  }
}, 15000);

bootstrap();
