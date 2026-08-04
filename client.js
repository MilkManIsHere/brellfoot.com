const socket = io();
const state = {
  me: null,
  servers: [],
  dms: [],
  users: [],
  currentServerId: null,
  currentChannelId: null,
  currentThreadId: null,
  mode: 'server',
  voice: {
    active: false,
    serverId: null,
    channelId: null,
    localStream: null,
    peers: new Map(),
    remoteAudios: new Map()
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
  serverList: document.getElementById('serverList'),
  newServerBtn: document.getElementById('newServerBtn'),
  serverName: document.getElementById('serverName'),
  meLabel: document.getElementById('meLabel'),
  textChannels: document.getElementById('textChannels'),
  voiceChannels: document.getElementById('voiceChannels'),
  dmList: document.getElementById('dmList'),
  dmForm: document.getElementById('dmForm'),
  chatTitle: document.getElementById('chatTitle'),
  chatSubtitle: document.getElementById('chatSubtitle'),
  createChannelBtn: document.getElementById('createChannelBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  messageList: document.getElementById('messageList'),
  messageForm: document.getElementById('messageForm'),
  messageInput: document.getElementById('messageInput'),
  logoutBtn: document.getElementById('logoutBtn'),
  voicePanel: document.getElementById('voicePanel'),
  voiceInfo: document.getElementById('voiceInfo'),
  voicePeers: document.getElementById('voicePeers'),
  leaveVoiceBtn: document.getElementById('leaveVoiceBtn')
};

function initials(name = '') {
  return (name || '?').trim().slice(0, 1).toUpperCase();
}

function setAuthError(text = '') {
  el.authError.textContent = text;
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

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function renderServers() {
  el.serverList.innerHTML = '';
  state.servers.forEach(server => {
    const btn = document.createElement('button');
    btn.className = `server-pill ${state.currentServerId === server.id ? 'active' : ''}`;
    btn.title = server.name;
    btn.textContent = initials(server.name);
    btn.onclick = () => selectServer(server.id);
    el.serverList.appendChild(btn);
  });
}

function renderSidebar() {
  const server = state.servers.find(s => s.id === state.currentServerId);
  el.serverName.textContent = server ? server.name : 'No server selected';
  el.meLabel.textContent = state.me ? `Signed in as @${state.me.username}` : '';
  renderServers();

  el.textChannels.innerHTML = '';
  el.voiceChannels.innerHTML = '';
  el.dmList.innerHTML = '';

  (server?.textChannels || []).forEach(channel => {
    const btn = document.createElement('button');
    btn.className = `channel-btn ${state.mode === 'server' && state.currentChannelId === channel.id ? 'active' : ''}`;
    btn.innerHTML = `<span class="kind">#</span>${channel.name}`;
    btn.onclick = () => selectTextChannel(server.id, channel.id);
    el.textChannels.appendChild(btn);
  });

  (server?.voiceChannels || []).forEach(channel => {
    const btn = document.createElement('button');
    btn.className = `channel-btn ${state.mode === 'voice' && state.currentChannelId === channel.id ? 'active' : ''}`;
    btn.innerHTML = `<span class="kind">♪</span>${channel.name}`;
    btn.onclick = () => selectVoiceChannel(server.id, channel.id);
    el.voiceChannels.appendChild(btn);
  });

  state.dms.forEach(thread => {
    const otherNames = (thread.others || []).map(u => u.username).join(', ') || 'DM';
    const btn = document.createElement('button');
    btn.className = `dm-btn ${state.mode === 'dm' && state.currentThreadId === thread.id ? 'active' : ''}`;
    btn.textContent = otherNames;
    btn.onclick = () => selectDm(thread.id);
    el.dmList.appendChild(btn);
  });
}

function renderMessages(messages = []) {
  el.messageList.innerHTML = '';
  messages.forEach(message => {
    const row = document.createElement('div');
    row.className = 'message';
    row.innerHTML = `
      <div class="avatar">${initials(message.author?.username || 'U')}</div>
      <div class="msg-bubble">
        <div class="msg-head">
          <span class="msg-user">${message.author?.username || 'Unknown'}</span>
          <span class="message-meta">${new Date(message.createdAt).toLocaleString()}</span>
        </div>
        <div class="msg-text"></div>
      </div>
    `;
    row.querySelector('.msg-text').textContent = message.content;
    el.messageList.appendChild(row);
  });
  el.messageList.scrollTop = el.messageList.scrollHeight;
}

async function loadServerMessages(serverId, channelId) {
  const data = await api(`/api/messages?scope=server&serverId=${encodeURIComponent(serverId)}&channelId=${encodeURIComponent(channelId)}`);
  renderMessages(data.messages || []);
}

async function loadDmMessages(threadId) {
  socket.emit('dm:join', { threadId });
  const data = await api(`/api/messages?scope=dm&threadId=${encodeURIComponent(threadId)}`);
  renderMessages(data.messages || []);
}

async function refreshState() {
  const data = await api('/api/state');
  state.me = data.me;
  state.servers = data.servers || [];
  state.dms = data.dms || [];
  state.users = data.users || [];

  if (!state.currentServerId && state.servers[0]) {
    state.currentServerId = state.servers[0].id;
    state.currentChannelId = state.servers[0].textChannels?.[0]?.id || null;
  }
  if (state.mode === 'server' && !state.currentChannelId) {
    const server = state.servers.find(s => s.id === state.currentServerId);
    state.currentChannelId = server?.textChannels?.[0]?.id || null;
  }

  showApp();
  renderSidebar();

  if (state.mode === 'server' && state.currentServerId && state.currentChannelId) {
    const server = state.servers.find(s => s.id === state.currentServerId);
    const channel = server?.textChannels?.find(c => c.id === state.currentChannelId);
    el.chatTitle.textContent = channel ? `# ${channel.name}` : 'Text Channel';
    el.chatSubtitle.textContent = server ? `in ${server.name}` : '';
    socket.emit('server:join', { serverId: state.currentServerId, channelId: state.currentChannelId });
    await loadServerMessages(state.currentServerId, state.currentChannelId);
  } else if (state.mode === 'dm' && state.currentThreadId) {
    const thread = state.dms.find(d => d.id === state.currentThreadId);
    el.chatTitle.textContent = thread ? (thread.others || []).map(u => u.username).join(', ') : 'Direct Message';
    el.chatSubtitle.textContent = 'Private conversation';
    await loadDmMessages(state.currentThreadId);
  } else if (state.mode === 'voice' && state.currentServerId && state.currentChannelId) {
    const server = state.servers.find(s => s.id === state.currentServerId);
    const channel = server?.voiceChannels?.find(c => c.id === state.currentChannelId);
    el.chatTitle.textContent = channel ? `♪ ${channel.name}` : 'Voice';
    el.chatSubtitle.textContent = server ? `in ${server.name}` : '';
    renderMessages([]);
  }

  renderVoicePanel();
}

function selectServer(serverId) {
  const server = state.servers.find(s => s.id === serverId);
  if (!server) return;
  state.currentServerId = serverId;
  state.mode = 'server';
  state.currentChannelId = server.textChannels?.[0]?.id || null;
  state.currentThreadId = null;
  stopVoice();
  refreshState().catch(console.error);
}

function selectTextChannel(serverId, channelId) {
  state.currentServerId = serverId;
  state.currentChannelId = channelId;
  state.currentThreadId = null;
  state.mode = 'server';
  stopVoice();
  refreshState().catch(console.error);
}

async function selectVoiceChannel(serverId, channelId) {
  state.currentServerId = serverId;
  state.currentChannelId = channelId;
  state.currentThreadId = null;
  state.mode = 'voice';
  await refreshState();
  await startVoice(serverId, channelId);
}

function selectDm(threadId) {
  state.mode = 'dm';
  state.currentThreadId = threadId;
  state.currentChannelId = null;
  stopVoice();
  refreshState().catch(console.error);
}

async function createServer() {
  const name = prompt('Server name?');
  if (!name) return;
  await api('/api/servers', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
  await refreshState();
}

async function createChannel() {
  const server = state.servers.find(s => s.id === state.currentServerId);
  if (!server) return;
  const kind = prompt('Type "text" or "voice"') || 'text';
  const name = prompt('Channel name?');
  if (!name) return;
  await api(`/api/servers/${server.id}/channels`, {
    method: 'POST',
    body: JSON.stringify({ name, kind })
  });
  await refreshState();
}

async function openDm(username) {
  const thread = await api('/api/dms/start', {
    method: 'POST',
    body: JSON.stringify({ username })
  });
  state.mode = 'dm';
  state.currentThreadId = thread.thread.id;
  state.currentChannelId = null;
  await refreshState();
}

function renderVoicePanel() {
  const active = state.mode === 'voice';
  el.voicePanel.classList.toggle('hidden', !active);
  if (!active) {
    el.voiceInfo.textContent = 'Not connected';
    el.voicePeers.innerHTML = '';
    return;
  }
  const server = state.servers.find(s => s.id === state.currentServerId);
  const channel = server?.voiceChannels?.find(c => c.id === state.currentChannelId);
  el.voiceInfo.textContent = `${channel?.name || 'Voice'} • connected`;
  el.voicePeers.innerHTML = '';
  for (const [peerId, peer] of state.voice.peers.entries()) {
    const pill = document.createElement('div');
    pill.className = 'voice-peer';
    pill.textContent = peer.username || peerId;
    el.voicePeers.appendChild(pill);
  }
}

async function startVoice(serverId, channelId) {
  stopVoice();
  state.voice.active = true;
  state.voice.serverId = serverId;
  state.voice.channelId = channelId;
  state.voice.peers = new Map();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    state.voice.localStream = stream;
  } catch (err) {
    alert('Microphone permission is required for voice chat.');
    state.mode = 'server';
    await refreshState();
    return;
  }

  socket.emit('voice:join', { serverId, channelId });

  socket.on('voice:peers', async ({ peers }) => {
    for (const peerId of peers) {
      if (state.voice.peers.has(peerId)) continue;
      await createPeerConnection(peerId, true);
    }
    renderVoicePanel();
  });

  socket.on('voice:peer-joined', async ({ peerId, username }) => {
    state.voice.peers.set(peerId, { username });
    renderVoicePanel();
  });

  socket.on('voice:peer-left', ({ peerId }) => {
    cleanupPeer(peerId);
    renderVoicePanel();
  });

  socket.on('voice:signal', async ({ from, data, username }) => {
    if (!state.voice.peers.has(from)) {
      state.voice.peers.set(from, { username });
    }
    let peer = state.voice.peers.get(from);
    if (!peer.pc) {
      await createPeerConnection(from, false);
      peer = state.voice.peers.get(from);
    }
    const pc = peer.pc;
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      if (data.description.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('voice:signal', { to: from, data: { description: pc.localDescription } });
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err) {}
    }
  });

  renderVoicePanel();
}

async function createPeerConnection(peerId, initiator) {
  const peerInfo = state.voice.peers.get(peerId) || {};
  if (peerInfo.pc) return peerInfo.pc;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  state.voice.localStream.getTracks().forEach(track => pc.addTrack(track, state.voice.localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('voice:signal', { to: peerId, data: { candidate: event.candidate } });
    }
  };

  pc.ontrack = (event) => {
    let audio = state.voice.remoteAudios.get(peerId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.controls = false;
      audio.dataset.peerId = peerId;
      document.body.appendChild(audio);
      state.voice.remoteAudios.set(peerId, audio);
    }
    audio.srcObject = event.streams[0];
  };

  state.voice.peers.set(peerId, { ...peerInfo, pc });

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice:signal', { to: peerId, data: { description: pc.localDescription } });
  }

  return pc;
}

function cleanupPeer(peerId) {
  const peer = state.voice.peers.get(peerId);
  if (peer?.pc) {
    try { peer.pc.close(); } catch (e) {}
  }
  const audio = state.voice.remoteAudios.get(peerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    state.voice.remoteAudios.delete(peerId);
  }
  state.voice.peers.delete(peerId);
}

function stopVoice() {
  if (!state.voice.active) return;
  socket.emit('voice:leave');
  socket.off('voice:peers');
  socket.off('voice:peer-joined');
  socket.off('voice:peer-left');
  socket.off('voice:signal');

  for (const peerId of [...state.voice.peers.keys()]) cleanupPeer(peerId);
  if (state.voice.localStream) {
    state.voice.localStream.getTracks().forEach(t => t.stop());
  }
  state.voice.localStream = null;
  state.voice.active = false;
  state.voice.serverId = null;
  state.voice.channelId = null;
  el.voicePeers.innerHTML = '';
  renderVoicePanel();
}

el.tabLogin.onclick = () => showAuth(true);
el.tabSignup.onclick = () => showAuth(false);

el.loginForm.onsubmit = async (e) => {
  e.preventDefault();
  setAuthError('');
  const form = new FormData(el.loginForm);
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form))
    });
    await refreshState();
  } catch (err) {
    setAuthError(err.message);
  }
};

el.signupForm.onsubmit = async (e) => {
  e.preventDefault();
  setAuthError('');
  const form = new FormData(el.signupForm);
  try {
    await api('/api/signup', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form))
    });
    await refreshState();
  } catch (err) {
    setAuthError(err.message);
  }
};

el.logoutBtn.onclick = async () => {
  await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {});
  location.reload();
};

el.newServerBtn.onclick = createServer;
el.createChannelBtn.onclick = createChannel;
el.refreshBtn.onclick = () => refreshState().catch(console.error);
el.leaveVoiceBtn.onclick = () => {
  state.mode = 'server';
  stopVoice();
  refreshState().catch(console.error);
};

el.dmForm.onsubmit = async (e) => {
  e.preventDefault();
  const form = new FormData(el.dmForm);
  const username = String(form.get('username') || '').trim();
  if (!username) return;
  await openDm(username);
  el.dmForm.reset();
};

el.messageForm.onsubmit = async (e) => {
  e.preventDefault();
  const content = el.messageInput.value.trim();
  if (!content) return;

  try {
    if (state.mode === 'dm' && state.currentThreadId) {
      await api('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'dm',
          threadId: state.currentThreadId,
          content
        })
      });
      el.messageInput.value = '';
      await loadDmMessages(state.currentThreadId);
      return;
    }

    if (state.mode === 'server' && state.currentServerId && state.currentChannelId) {
      await api('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'server',
          serverId: state.currentServerId,
          channelId: state.currentChannelId,
          content
        })
      });
      el.messageInput.value = '';
      await loadServerMessages(state.currentServerId, state.currentChannelId);
      return;
    }
  } catch (err) {
    alert(err.message);
  }
};

socket.on('message:new', async () => {
  if (state.mode === 'server' && state.currentServerId && state.currentChannelId) {
    await loadServerMessages(state.currentServerId, state.currentChannelId);
  } else if (state.mode === 'dm' && state.currentThreadId) {
    await loadDmMessages(state.currentThreadId);
  }
});

socket.on('state:changed', () => {
  refreshState().catch(() => {});
});

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
  }, 20000);
})();
