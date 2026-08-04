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
const VOICE_ROOM = 'voice:lobby';

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
  const fallback = { users: [], messages: [] };
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(fallback, null, 2));
    return fallback;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : []
    };
  } catch {
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
  }, 40);
}

function normalizeUsername(value) {
  return String(value || '').trim();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt
  };
}

function validateUsername(username) {
  return /^[A-Za-z0-9_-]{1,20}$/.test(username);
}

function validatePassword(password) {
  return /^[A-Za-z0-9_-]{6,20}$/.test(password);
}

function authRequired(req, res, next) {
  const userId = req.session.userId;
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}

function isUsernameTaken(username) {
  return db.users.some(u => u.username.toLowerCase() === username.toLowerCase());
}

function getVoiceParticipants() {
  return Array.from(io.sockets.adapter.rooms.get(VOICE_ROOM) || [])
    .map(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket?.data?.voiceUser) return null;
      return {
        socketId,
        userId: socket.data.voiceUser.id,
        username: socket.data.voiceUser.username,
        muted: !!socket.data.voiceMuted,
        deafened: !!socket.data.voiceDeafened,
        joinedAt: socket.data.voiceJoinedAt || null
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
}

function buildState(user) {
  const users = db.users
    .map(u => ({
      ...publicUser(u),
      online: Array.from(io.sockets.sockets.values()).some(socket => socket.data?.voiceUser?.id === u.id || socket.request.session?.userId === u.id),
      inVoice: Array.from(io.sockets.sockets.values()).some(socket => socket.data?.voiceUser?.id === u.id),
      muted: Array.from(io.sockets.sockets.values()).some(socket => socket.data?.voiceUser?.id === u.id && socket.data.voiceMuted),
      deafened: Array.from(io.sockets.sockets.values()).some(socket => socket.data?.voiceUser?.id === u.id && socket.data.voiceDeafened)
    }))
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));

  const messages = db.messages
    .slice(-200)
    .map(m => ({
      ...m,
      author: publicUser(db.users.find(u => u.id === m.userId))
    }));

  return {
    me: publicUser(user),
    users,
    messages,
    voiceParticipants: getVoiceParticipants()
  };
}

function emitRoomState() {
  io.to(VOICE_ROOM).emit('voice:participants', { participants: getVoiceParticipants() });
  io.emit('state:changed');
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/state', authRequired, (req, res) => {
  res.json(buildState(req.user));
});

app.get('/api/users', authRequired, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const users = db.users
    .filter(u => !q || u.username.toLowerCase().includes(q))
    .map(u => ({
      ...publicUser(u),
      online: Array.from(io.sockets.sockets.values()).some(socket => socket.data?.voiceUser?.id === u.id || socket.request.session?.userId === u.id),
      inVoice: Array.from(io.sockets.sockets.values()).some(socket => socket.data?.voiceUser?.id === u.id),
      muted: Array.from(io.sockets.sockets.values()).some(socket => socket.data?.voiceUser?.id === u.id && socket.data.voiceMuted),
      deafened: Array.from(io.sockets.sockets.values()).some(socket => socket.data?.voiceUser?.id === u.id && socket.data.voiceDeafened)
    }))
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
  res.json({ users });
});

app.post('/api/signup', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  if (!validateUsername(username)) {
    return res.status(400).json({ error: 'Username must be 1-20 characters using letters, numbers, _ or -' });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ error: 'Password must be 6-20 characters using letters, numbers, _ or -' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }
  if (isUsernameTaken(username)) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  const user = {
    id: createId('usr_'),
    username,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  saveDB();
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user), state: buildState(user) });
});

app.post('/api/login', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (!password) return res.status(400).json({ error: 'Password is required' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });

  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(400).json({ error: 'Invalid username or password' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid username or password' });

  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user), state: buildState(user) });
});

app.post('/api/logout', authRequired, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/messages', authRequired, (req, res) => {
  const messages = db.messages.map(m => ({
    ...m,
    author: publicUser(db.users.find(u => u.id === m.userId))
  }));
  res.json({ messages });
});

app.post('/api/messages', authRequired, (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Message cannot be empty' });

  const message = {
    id: createId('msg_'),
    userId: req.user.id,
    content,
    createdAt: new Date().toISOString()
  };
  db.messages.push(message);
  if (db.messages.length > 500) db.messages = db.messages.slice(-500);
  saveDB();

  const payload = { ...message, author: publicUser(req.user) };
  io.emit('message:new', payload);
  io.emit('state:changed');
  res.json({ ok: true, message: payload });
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

function getSocketUser(socket) {
  const userId = socket.request.session?.userId;
  return db.users.find(u => u.id === userId) || null;
}

function syncVoiceState() {
  io.to(VOICE_ROOM).emit('voice:participants', { participants: getVoiceParticipants() });
  io.emit('state:changed');
}

io.on('connection', (socket) => {
  const user = getSocketUser(socket);
  if (!user) return;

  socket.data.user = user;
  socket.data.isLoggedIn = true;

  socket.on('voice:join', async () => {
    const freshUser = getSocketUser(socket);
    if (!freshUser) return;
    socket.data.voiceUser = publicUser(freshUser);
    socket.data.voiceMuted = false;
    socket.data.voiceDeafened = false;
    socket.data.voiceJoinedAt = new Date().toISOString();
    socket.join(VOICE_ROOM);

    const roomPeers = Array.from(io.sockets.adapter.rooms.get(VOICE_ROOM) || [])
      .filter(id => id !== socket.id)
      .map(id => io.sockets.sockets.get(id))
      .filter(Boolean)
      .map(s => ({
        socketId: s.id,
        username: s.data?.voiceUser?.username || 'Unknown'
      }));

    socket.emit('voice:participants', { participants: getVoiceParticipants() });
    socket.emit('voice:peers', { peers: roomPeers });
    socket.to(VOICE_ROOM).emit('voice:peer-joined', {
      socketId: socket.id,
      username: socket.data.voiceUser.username
    });
    syncVoiceState();
  });

  socket.on('voice:status', ({ muted, deafened }) => {
    if (!socket.data.voiceUser) return;
    socket.data.voiceMuted = !!muted;
    socket.data.voiceDeafened = !!deafened;
    syncVoiceState();
  });

  socket.on('voice:leave', () => {
    if (socket.rooms.has(VOICE_ROOM)) {
      socket.leave(VOICE_ROOM);
      socket.to(VOICE_ROOM).emit('voice:peer-left', { socketId: socket.id });
      delete socket.data.voiceUser;
      delete socket.data.voiceMuted;
      delete socket.data.voiceDeafened;
      delete socket.data.voiceJoinedAt;
      syncVoiceState();
    }
  });

  socket.on('voice:signal', ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit('voice:signal', {
      from: socket.id,
      data,
      username: socket.data.voiceUser?.username || socket.data.user?.username || 'Unknown'
    });
  });

  socket.on('message:post', ({ content }) => {
    const text = String(content || '').trim();
    if (!text) return;
    const freshUser = getSocketUser(socket);
    if (!freshUser) return;

    const message = {
      id: createId('msg_'),
      userId: freshUser.id,
      content: text,
      createdAt: new Date().toISOString()
    };
    db.messages.push(message);
    if (db.messages.length > 500) db.messages = db.messages.slice(-500);
    saveDB();

    const payload = { ...message, author: publicUser(freshUser) };
    io.emit('message:new', payload);
    io.emit('state:changed');
  });

  socket.on('disconnect', () => {
    if (socket.rooms.has(VOICE_ROOM)) {
      socket.to(VOICE_ROOM).emit('voice:peer-left', { socketId: socket.id });
      syncVoiceState();
    }
  });
});

server.listen(PORT, () => {
  console.log(`PulseCord running at http://localhost:${PORT}`);
});
