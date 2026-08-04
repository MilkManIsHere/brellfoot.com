const socket = io();

const state = {
  me: null,
  users: [],
  messages: [],
  filteredUsers: [],
  search: '',
  sort: 'created-asc',
  connectedToVoice: false,
  muted: false,
  deafened: false,
  voice: {
    localStream: null,
    participants: [],
    peers: new Map(),
    remoteAudios: new Map(),
    joined: false
  }
};

const el = {
  app: document.getElementById('app'),
  authOverlay: document.getElementById('authOverlay'),
  authError: document.getElementById('authError'),
  tabLogin: document.getElementById('tabLogin'),
  tabSignup: document.getElementById('tabSignup'),
  loginForm: document.getElementById('loginForm'),
  signupForm: document.getElementById('signupForm'),
  logoutBtn: document.getElementById('logoutBtn'),
  meLabel: document.getElementById('meLabel'),
  accountSearch: document.getElementById('accountSearch'),
  sortSelect: document.getElementById('sortSelect'),
  accountList: document.getElementById('accountList'),
  chatTitle: document.getElementById('chatTitle'),
  chatSubtitle: document.getElementById('chatSubtitle'),
  joinVoiceBtn: document.getElementById('joinVoiceBtn'),
  leaveVoiceBtn: document.getElementById('leaveVoiceBtn'),
  muteBtn: document.getElementById('muteBtn'),
  deafenBtn: document.getElementById('deafenBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  voiceInfo: document.getElementById('voiceInfo'),
  voicePeers: document.getElementById('voicePeers'),
  messageList: document.getElementById('messageList'),
  messageForm: document.getElementById('messageForm'),
  messageInput: document.getElementById('messageInput')
};

function api(url, options = {}) {
  return fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options
  }).then(async res => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  });
}

function initials(name = '') {
  return (name || '?').trim().slice(0, 1).toUpperCase();
}

function formatDate(iso) {
  if (!iso) return 'Unknown';
  return new Date(iso).toLocaleString();
}

function setAuthError(message = '') {
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

function togglePasswordVisibility(form, visible) {
  const fields = form.querySelectorAll('input[type="password"], input[data-password-field]');
  fields.forEach(field => {
    if (field.dataset.passwordField !== 'true') return;
    field.type = visible ? 'text' : 'password';
  });
}

function wirePasswordToggle(form) {
  const passwordInputs = form.querySelectorAll('input[name="password"], input[name="confirmPassword"]');
  passwordInputs.forEach(input => input.dataset.passwordField = 'true');
  const toggle = form.querySelector('.reveal-toggle');
  toggle.addEventListener('change', () => {
    passwordInputs.forEach(field => field.type = toggle.checked ? 'text' : 'password');
  });
}

function sortUsers(users) {
  const arr = [...users];
  switch (state.sort) {
    case 'created-desc':
      return arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    case 'name-asc':
      return arr.sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
    case 'name-desc':
      return arr.sort((a, b) => b.username.localeCompare(a.username, undefined, { sensitivity: 'base' }));
    case 'created-asc':
    default:
      return arr.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }
}

function renderAccounts() {
  const search = state.search.trim().toLowerCase();
  const filtered = state.users.filter(user => !search || user.username.toLowerCase().includes(search));
  const sorted = sortUsers(filtered);
  state.filteredUsers = sorted;

  el.accountList.innerHTML = '';
  if (!sorted.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No accounts match that search.';
    el.accountList.appendChild(empty);
    return;
  }

  sorted.forEach(user => {
    const card = document.createElement('div');
    card.className = 'account-card';

    const top = document.createElement('div');
    top.className = 'account-top';

    const left = document.createElement('div');
    left.innerHTML = `<div class="account-name">@${user.username}</div><div class="account-meta">Created ${formatDate(user.createdAt)}</div>`;

    const right = document.createElement('div');
    const badges = [];
    if (state.me && user.id === state.me.id) badges.push('<span class="badge me">You</span>');
    if (user.online) badges.push('<span class="badge online">Online</span>');
    if (user.inVoice) badges.push('<span class="badge voice">Voice</span>');
    if (user.muted) badges.push('<span class="badge muted">Muted</span>');
    if (user.deafened) badges.push('<span class="badge deafened">Deafened</span>');
    right.innerHTML = badges.join(' ');

    top.appendChild(left);
    top.appendChild(right);
    card.appendChild(top);
    el.accountList.appendChild(card);
  });
}

function renderMessages() {
  el.messageList.innerHTML = '';
  if (!state.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<div><strong>No messages yet.</strong><div class="help-text">Say something to start the room.</div></div>';
    el.messageList.appendChild(empty);
    return;
  }

  state.messages.forEach(message => {
    const row = document.createElement('div');
    row.className = 'message';
    const author = message.author?.username || 'Unknown';
    const avatar = initials(author);
    row.innerHTML = `
      <div class="avatar">${avatar}</div>
      <div class="msg-bubble">
        <div class="msg-head">
          <div class="msg-user">@${author}</div>
          <div class="message-meta">${formatDate(message.createdAt)}</div>
        </div>
        <div class="msg-text"></div>
      </div>
    `;
    row.querySelector('.msg-text').textContent = message.content;
    el.messageList.appendChild(row);
  });
  el.messageList.scrollTop = el.messageList.scrollHeight;
}

function renderVoice() {
  const participants = state.voice.participants || [];
  el.voicePeers.innerHTML = '';
  if (!state.voice.joined) {
    el.voiceInfo.textContent = 'Not connected';
    const empty = document.createElement('div');
    empty.className = 'help-text';
    empty.textContent = 'Join voice to see people here and connect audio.';
    el.voicePeers.appendChild(empty);
    return;
  }

  el.voiceInfo.textContent = `${participants.length} connected`;
  participants.forEach(p => {
    const pill = document.createElement('div');
    pill.className = 'voice-peer';
    const flags = [];
    if (state.me && p.userId === state.me.id) flags.push('You');
    if (p.muted) flags.push('Muted');
    if (p.deafened) flags.push('Deafened');
    pill.textContent = flags.length ? `${p.username} • ${flags.join(' • ')}` : p.username;
    el.voicePeers.appendChild(pill);
  });
}

function updateControls() {
  el.muteBtn.textContent = state.muted ? 'Unmute' : 'Mute';
  el.deafenBtn.textContent = state.deafened ? 'Undeafen' : 'Deafen';
  el.joinVoiceBtn.disabled = state.voice.joined;
  el.leaveVoiceBtn.disabled = !state.voice.joined;
}

async function refreshState() {
  const data = await api('/api/state');
  state.me = data.me;
  state.users = data.users || [];
  state.messages = data.messages || [];
  state.voice.participants = data.voiceParticipants || [];
  renderAccounts();
  renderMessages();
  renderVoice();
  updateControls();
  el.meLabel.textContent = state.me ? `Signed in as @${state.me.username}` : '';
  showApp();
}

function clearPeer(peerId) {
  const peer = state.voice.peers.get(peerId);
  if (peer?.pc) {
    try { peer.pc.close(); } catch (_) {}
  }
  const audio = state.voice.remoteAudios.get(peerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    state.voice.remoteAudios.delete(peerId);
  }
  state.voice.peers.delete(peerId);
}

async function createPeerConnection(peerId, initiator) {
  const existing = state.voice.peers.get(peerId);
  if (existing?.pc) return existing.pc;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  if (state.voice.localStream) {
    state.voice.localStream.getTracks().forEach(track => pc.addTrack(track, state.voice.localStream));
  }

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('voice:signal', { to: peerId, data: { candidate: event.candidate } });
    }
  };

  pc.ontrack = event => {
    let audio = state.voice.remoteAudios.get(peerId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.dataset.peerId = peerId;
      document.body.appendChild(audio);
      state.voice.remoteAudios.set(peerId, audio);
    }
    audio.srcObject = event.streams[0];
    if (state.deafened) audio.volume = 0;
  };

  state.voice.peers.set(peerId, { ...(existing || {}), pc });

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice:signal', { to: peerId, data: { description: pc.localDescription } });
  }

  return pc;
}

async function joinVoice() {
  if (state.voice.joined) return;
  try {
    state.voice.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    alert('Microphone permission is required for voice chat.');
    return;
  }

  state.voice.joined = true;
  socket.emit('voice:join');
  updateControls();
}

function leaveVoice() {
  if (!state.voice.joined) return;
  socket.emit('voice:leave');
  state.voice.participants = [];
  [...state.voice.peers.keys()].forEach(clearPeer);
  if (state.voice.localStream) {
    state.voice.localStream.getTracks().forEach(track => track.stop());
  }
  state.voice.localStream = null;
  state.voice.joined = false;
  state.muted = false;
  state.deafened = false;
  renderVoice();
  updateControls();
}

function setAudioState() {
  if (state.deafened) {
    state.muted = true;
  }
  if (state.voice.localStream) {
    state.voice.localStream.getAudioTracks().forEach(track => {
      track.enabled = !state.muted;
    });
  }
  state.voice.remoteAudios.forEach(audio => {
    audio.muted = state.deafened;
    audio.volume = state.deafened ? 0 : 1;
  });
  socket.emit('voice:status', { muted: state.muted, deafened: state.deafened });
  updateControls();
}

async function sendMessage() {
  const content = el.messageInput.value.trim();
  if (!content) return;
  await api('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ content })
  });
  el.messageInput.value = '';
}

socket.on('message:new', payload => {
  state.messages.push(payload);
  state.messages = state.messages.slice(-200);
  renderMessages();
});

socket.on('voice:participants', ({ participants }) => {
  state.voice.participants = participants || [];
  renderVoice();
  updateControls();
});

socket.on('voice:peers', async ({ peers }) => {
  for (const peer of peers || []) {
    if (!state.voice.peers.has(peer.socketId)) {
      await createPeerConnection(peer.socketId, true);
    }
  }
});

socket.on('voice:peer-joined', async ({ socketId }) => {
  if (socketId && !state.voice.peers.has(socketId)) {
    await createPeerConnection(socketId, false);
  }
  renderVoice();
});

socket.on('voice:peer-left', ({ socketId }) => {
  if (socketId) clearPeer(socketId);
  renderVoice();
});

socket.on('voice:signal', async ({ from, data, username }) => {
  if (!state.voice.peers.has(from)) {
    state.voice.peers.set(from, { username });
    await createPeerConnection(from, false);
  }
  const peer = state.voice.peers.get(from);
  const pc = peer?.pc;
  if (!pc) return;

  if (data.description) {
    await pc.setRemoteDescription(data.description);
    if (data.description.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice:signal', { to: from, data: { description: pc.localDescription } });
    }
  } else if (data.candidate) {
    try { await pc.addIceCandidate(data.candidate); } catch (_) {}
  }
});

socket.on('state:changed', () => {
  refreshState().catch(() => {});
});

wirePasswordToggle(el.loginForm);
wirePasswordToggle(el.signupForm);

el.tabLogin.onclick = () => showAuth(true);
el.tabSignup.onclick = () => showAuth(false);

el.loginForm.onsubmit = async e => {
  e.preventDefault();
  setAuthError('');
  const form = new FormData(el.loginForm);
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form))
    });
    await refreshState();
    await joinVoice().catch(() => {});
  } catch (err) {
    setAuthError(err.message);
  }
};

el.signupForm.onsubmit = async e => {
  e.preventDefault();
  setAuthError('');
  const form = new FormData(el.signupForm);
  try {
    await api('/api/signup', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form))
    });
    await refreshState();
    await joinVoice().catch(() => {});
  } catch (err) {
    setAuthError(err.message);
  }
};

el.logoutBtn.onclick = async () => {
  try {
    await api('/api/logout', { method: 'POST', body: '{}' });
  } catch (_) {}
  leaveVoice();
  location.reload();
};

el.accountSearch.addEventListener('input', () => {
  state.search = el.accountSearch.value;
  renderAccounts();
});

el.sortSelect.addEventListener('change', () => {
  state.sort = el.sortSelect.value;
  renderAccounts();
});

el.joinVoiceBtn.onclick = () => joinVoice();
el.leaveVoiceBtn.onclick = () => leaveVoice();
el.muteBtn.onclick = () => {
  state.muted = !state.muted;
  setAudioState();
};
el.deafenBtn.onclick = () => {
  state.deafened = !state.deafened;
  if (state.deafened) state.muted = true;
  setAudioState();
};
el.refreshBtn.onclick = () => refreshState().catch(() => {});

el.messageForm.onsubmit = async e => {
  e.preventDefault();
  try {
    await sendMessage();
  } catch (err) {
    alert(err.message);
  }
};

(async () => {
  try {
    const me = await api('/api/me');
    if (me?.user) {
      await refreshState();
    } else {
      showAuth(true);
    }
  } catch {
    showAuth(true);
  }

  setInterval(() => {
    if (!document.hidden) refreshState().catch(() => {});
  }, 15000);
})();
