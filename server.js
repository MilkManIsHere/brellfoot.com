const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db.json');

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'pulsecord-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax'
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(express.static(__dirname));

io.engine.use(sessionMiddleware);

function createId(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { users: [], servers: [], messages: [], dms: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    const fallback = { users: [], servers: [], messages: [], dms: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

let db = readDB();
let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  }, 50);
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

function ensureDefaultServerForUser(userId) {
  const mine = db.servers.filter(s => s.ownerId === userId || s.memberIds.includes(userId));
  if (mine.length > 0) return;
  const server = {
    id: createId('srv_'),
    name: 'Welcome Hub',
    ownerId: userId,
    memberIds: [userId],
    textChannels: [
      { id: createId('txt_'), name: 'general' },
      { id: createId('txt_'), name: 'updates' }
    ],
    voiceChannels: [
      { id: createId('voc_'), name: 'Voice' }
    ],
    createdAt: new Date().toISOString()
  };
  db.servers.push(server);
  saveDB();
}

function authRequired(req, res, next) {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Not signed in' });
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}

function getServerForUser(serverId, userId) {
  return db.servers.find(s => s.id === serverId && (s.ownerId === userId || s.memberIds.includes(userId)));
}

function getDmThreadId(participants) {
  return participants.slice().sort().join('::');
}

function getThreadMessages(threadId) {
  return db.messages
    .filter(m => m.threadType === 'dm' && m.threadId === threadId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function buildState(user) {
  ensureDefaultServerForUser(user.id);

  const servers = db.servers
    .filter(s => s.ownerId === user.id || s.memberIds.includes(user.id))
    .map(s => ({
      ...s,
      textChannels: s.textChannels || [],
      voiceChannels: s.voiceChannels || [],
      unread: db.messages.filter(m => m.threadType === 'server' && m.serverId === s.id && new Date(m.createdAt).getTime() > (user.lastSeenAt || 0)).length
    }));

  const dms = db.dms
    .filter(d => d.participants.includes(user.id))
    .map(d => {
      const otherIds = d.participants.filter(p => p !== user.id);
      const others = otherIds.map(id => publicUser(db.users.find(u => u.id === id))).filter(Boolean);
      const lastMessage = db.messages
        .filter(m => m.threadType === 'dm' && m.threadId === d.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
      return { ...d, others, lastMessage };
    })
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const allUsers = db.users
    .filter(u => u.id !== user.id)
    .map(publicUser)
    .sort((a, b) => a.username.localeCompare(b.username));

  return {
    me: publicUser(user),
    servers,
    dms,
    users: allUsers
  };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/state', authRequired, (req, res) => {
  req.user.lastSeenAt = Date.now();
  saveDB();
  res.json(buildState(req.user));
});

app.post('/api/signup', async (req, res) => {
  const username = normalizeName(req.body.username);
  const password = String(req.body.password || '');

  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  const user = {
    id: createId('usr_'),
    username,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: new Date().toISOString(),
    lastSeenAt: Date.now()
  };

  db.users.push(user);
  saveDB();

  req.session.userId = user.id;
  ensureDefaultServerForUser(user.id);
  res.json({ ok: true, user: publicUser(user), state: buildState(user) });
});

app.post('/api/login', async (req, res) => {
  const username = normalizeName(req.body.username);
  const password = String(req.body.password || '');

  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(400).json({ error: 'Invalid username or password' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid username or password' });

  req.session.userId = user.id;
  user.lastSeenAt = Date.now();
  ensureDefaultServerForUser(user.id);
  saveDB();
  res.json({ ok: true, user: publicUser(user), state: buildState(user) });
});

app.post('/api/logout', authRequired, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post('/api/servers', authRequired, (req, res) => {
  const name = normalizeName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Server name is required' });

  const server = {
    id: createId('srv_'),
    name,
    ownerId: req.user.id,
    memberIds: [req.user.id],
    textChannels: [
      { id: createId('txt_'), name: 'general' }
    ],
    voiceChannels: [
      { id: createId('voc_'), name: 'Voice' }
    ],
    createdAt: new Date().toISOString()
  };
  db.servers.push(server);
  saveDB();
  io.emit('state:changed');
  res.json({ ok: true, server });
});

app.post('/api/servers/:serverId/channels', authRequired, (req, res) => {
  const server = getServerForUser(req.params.serverId, req.user.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const name = normalizeName(req.body.name);
  const kind = String(req.body.kind || 'text');
  if (!name) return res.status(400).json({ error: 'Channel name is required' });

  if (kind === 'voice') {
    const channel = { id: createId('voc_'), name };
    server.voiceChannels = server.voiceChannels || [];
    server.voiceChannels.push(channel);
    saveDB();
    io.emit('state:changed');
    return res.json({ ok: true, channel });
  }

  const channel = { id: createId('txt_'), name };
  server.textChannels = server.textChannels || [];
  server.textChannels.push(channel);
  saveDB();
  io.emit('state:changed');
  res.json({ ok: true, channel });
});

app.post('/api/dms/start', authRequired, (req, res) => {
  const username = normalizeName(req.body.username);
  const other = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!other) return res.status(404).json({ error: 'User not found' });
  if (other.id === req.user.id) return res.status(400).json({ error: 'You cannot DM yourself' });

  const participants = [req.user.id, other.id].sort();
  const id = getDmThreadId(participants);
  let thread = db.dms.find(d => d.id === id);
  if (!thread) {
    thread = {
      id,
      participants,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.dms.push(thread);
    saveDB();
    io.emit('state:changed');
  }
  res.json({ ok: true, thread });
});

app.get('/api/messages', authRequired, (req, res) => {
  const scope = String(req.query.scope || 'server');
  const serverId = String(req.query.serverId || '');
  const channelId = String(req.query.channelId || '');
  const threadId = String(req.query.threadId || '');

  if (scope === 'dm') {
    const thread = db.dms.find(d => d.id === threadId && d.participants.includes(req.user.id));
    if (!thread) return res.status(404).json({ error: 'DM not found' });
    const messages = getThreadMessages(thread.id).map(m => ({
      ...m,
      author: publicUser(db.users.find(u => u.id === m.userId))
    }));
    return res.json({ messages });
  }

  const server = getServerForUser(serverId, req.user.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const messages = db.messages
    .filter(m => m.threadType === 'server' && m.serverId === serverId && m.channelId === channelId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(m => ({
      ...m,
      author: publicUser(db.users.find(u => u.id === m.userId))
    }));

  res.json({ messages });
});

app.post('/api/messages', authRequired, (req, res) => {
  const scope = String(req.body.scope || 'server');

  if (scope === 'dm') {
    const threadId = String(req.body.threadId || '');
    const content = String(req.body.content || '').trim();
    const thread = db.dms.find(d => d.id === threadId && d.participants.includes(req.user.id));
    if (!thread) return res.status(404).json({ error: 'DM not found' });
    if (!content) return res.status(400).json({ error: 'Message cannot be empty' });

    const message = {
      id: createId('msg_'),
      threadType: 'dm',
      threadId: thread.id,
      userId: req.user.id,
      content,
      createdAt: new Date().toISOString()
    };
    db.messages.push(message);
    thread.updatedAt = message.createdAt;
    saveDB();

    const payload = { ...message, author: publicUser(req.user) };
    io.to(`dm:${thread.id}`).emit('message:new', payload);
    io.emit('state:changed');
    return res.json({ ok: true, message: payload });
  }

  const serverId = String(req.body.serverId || '');
  const channelId = String(req.body.channelId || '');
  const content = String(req.body.content || '').trim();
  const serverObj = getServerForUser(serverId, req.user.id);
  if (!serverObj) return res.status(404).json({ error: 'Server not found' });
  if (!content) return res.status(400).json({ error: 'Message cannot be empty' });

  const channelExists = (serverObj.textChannels || []).some(c => c.id === channelId);
  if (!channelExists) return res.status(404).json({ error: 'Text channel not found' });

  const message = {
    id: createId('msg_'),
    threadType: 'server',
    serverId,
    channelId,
    userId: req.user.id,
    content,
    createdAt: new Date().toISOString()
  };
  db.messages.push(message);
  saveDB();

  const payload = { ...message, author: publicUser(req.user) };
  io.to(`server:${serverId}:${channelId}`).emit('message:new', payload);
  io.emit('state:changed');
  res.json({ ok: true, message: payload });
});

app.get('/api/search-users', authRequired, (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const users = db.users
    .filter(u => u.id !== req.user.id && (!q || u.username.toLowerCase().includes(q)))
    .slice(0, 20)
    .map(publicUser);
  res.json({ users });
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
  const userId = socket.request.session?.userId;
  const user = db.users.find(u => u.id === userId);
  if (!user) return;

  socket.userId = user.id;
  socket.user = user;

  socket.on('server:join', ({ serverId, channelId }) => {
    const serverObj = getServerForUser(serverId, socket.userId);
    if (!serverObj) return;
    if (channelId) {
      socket.join(`server:${serverId}:${channelId}`);
    }
  });

  socket.on('dm:join', ({ threadId }) => {
    const thread = db.dms.find(d => d.id === threadId && d.participants.includes(socket.userId));
    if (!thread) return;
    socket.join(`dm:${threadId}`);
  });

  socket.on('message:server', ({ serverId, channelId, content }) => {
    const serverObj = getServerForUser(serverId, socket.userId);
    const channelExists = serverObj && (serverObj.textChannels || []).some(c => c.id === channelId);
    const text = String(content || '').trim();
    if (!serverObj || !channelExists || !text) return;

    const message = {
      id: createId('msg_'),
      threadType: 'server',
      serverId,
      channelId,
      userId: socket.userId,
      content: text,
      createdAt: new Date().toISOString()
    };
    db.messages.push(message);
    saveDB();
    const payload = { ...message, author: publicUser(socket.user) };
    io.to(`server:${serverId}:${channelId}`).emit('message:new', payload);
    io.emit('state:changed');
  });

  socket.on('message:dm', ({ threadId, content }) => {
    const thread = db.dms.find(d => d.id === threadId && d.participants.includes(socket.userId));
    const text = String(content || '').trim();
    if (!thread || !text) return;

    const message = {
      id: createId('msg_'),
      threadType: 'dm',
      threadId: thread.id,
      userId: socket.userId,
      content: text,
      createdAt: new Date().toISOString()
    };
    db.messages.push(message);
    thread.updatedAt = message.createdAt;
    saveDB();

    const payload = { ...message, author: publicUser(socket.user) };
    io.to(`dm:${thread.id}`).emit('message:new', payload);
    io.emit('state:changed');
  });

  socket.on('voice:join', ({ serverId, channelId }) => {
    const serverObj = getServerForUser(serverId, socket.userId);
    const isVoice = serverObj && (serverObj.voiceChannels || []).some(c => c.id === channelId);
    if (!serverObj || !isVoice) return;

    const room = `voice:${serverId}:${channelId}`;
    const peers = Array.from(io.sockets.adapter.rooms.get(room) || []).filter(id => id !== socket.id);
    socket.join(room);
    socket.data.voiceRoom = room;
    socket.data.voiceChannel = { serverId, channelId };

    socket.emit('voice:peers', { peers });
    socket.to(room).emit('voice:peer-joined', { peerId: socket.id, username: socket.user.username });
  });

  socket.on('voice:signal', ({ to, data }) => {
    if (!to) return;
    io.to(to).emit('voice:signal', { from: socket.id, data, username: socket.user.username });
  });

  socket.on('voice:leave', () => {
    const room = socket.data.voiceRoom;
    if (room) {
      socket.to(room).emit('voice:peer-left', { peerId: socket.id });
      socket.leave(room);
      delete socket.data.voiceRoom;
      delete socket.data.voiceChannel;
    }
  });

  socket.on('disconnect', () => {
    const room = socket.data.voiceRoom;
    if (room) {
      socket.to(room).emit('voice:peer-left', { peerId: socket.id });
    }
  });
});

server.listen(PORT, () => {
  console.log(`PulseCord running at http://localhost:${PORT}`);
});
