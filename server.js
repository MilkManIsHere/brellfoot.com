const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { execFileSync } = require('child_process');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_VIDEO_SECONDS = 20 * 60; // 20 minutes

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function blankDB() {
  return { users: [], videos: [], comments: [] };
}

function loadDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) return blankDB();
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      videos: Array.isArray(parsed.videos) ? parsed.videos : [],
      comments: Array.isArray(parsed.comments) ? parsed.comments : []
    };
  } catch {
    return blankDB();
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeUsername(value) {
  return String(value || '').trim();
}

function validateUsername(username) {
  return /^[A-Za-z0-9_-]{1,20}$/.test(username);
}

function validatePassword(password) {
  return /^[A-Za-z0-9_-]{6,20}$/.test(password);
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

function publicComment(comment) {
  const author = db.users.find(u => u.id === comment.userId);
  return { id: comment.id, text: comment.text, createdAt: comment.createdAt, author: publicUser(author) };
}

function publicVideo(video) {
  const author = db.users.find(u => u.id === video.userId);
  const comments = db.comments.filter(c => c.videoId === video.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    filename: video.filename,
    mimeType: video.mimeType,
    size: video.size,
    duration: video.duration,
    createdAt: video.createdAt,
    author: publicUser(author),
    comments: comments.map(publicComment)
  };
}

function sortVideos(videos) {
  return [...videos].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function authRequired(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not signed in' });
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'retrotube-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
});

app.use(sessionMiddleware);
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(ROOT));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 16).toLowerCase();
    cb(null, `${uid('vid_')}${ext || '.bin'}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('video/')) return cb(null, true);
    cb(new Error('Only video files are allowed'));
  }
});

function emitLibraryUpdate() {
  io.emit('library:update');
}

function emitVideoChanged(videoId) {
  io.emit('video:changed', videoId);
}

function probeDurationSeconds(filePath) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath
    ], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    const duration = Number(parsed?.format?.duration);
    return Number.isFinite(duration) ? duration : null;
  } catch (err) {
    console.error('ffprobe failed:', err.message);
    return null;
  }
}

function deleteFileSafe(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Failed to delete file:', err.message);
  }
}

app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/users', authRequired, (_req, res) => {
  const users = db.users.map(publicUser).sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
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
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  const user = {
    id: uid('usr_'),
    username,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  saveDB();
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
  emitLibraryUpdate();
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
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/logout', authRequired, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/videos', authRequired, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const videos = sortVideos(db.videos)
    .filter(v => {
      if (!q) return true;
      const author = db.users.find(u => u.id === v.userId);
      return [v.title, v.description, author?.username || ''].join(' ').toLowerCase().includes(q);
    })
    .map(publicVideo);
  res.json({ videos });
});

app.get('/api/videos/:id', authRequired, (req, res) => {
  const video = db.videos.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  res.json({ video: publicVideo(video) });
});

app.post('/api/upload', authRequired, (req, res) => {
  upload.single('video')(req, res, err => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'File is larger than 20 MB'
        : err.message || 'Upload failed';
      return res.status(400).json({ error: message });
    }

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!req.file) return res.status(400).json({ error: 'Video file is required' });

    const duration = probeDurationSeconds(req.file.path);
    if (duration != null && duration > MAX_VIDEO_SECONDS) {
      deleteFileSafe(req.file.path);
      return res.status(400).json({ error: 'Video must be 20 minutes or shorter' });
    }

    const video = {
      id: uid('vid_'),
      userId: req.user.id,
      title,
      description,
      filename: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      duration: duration == null ? null : Math.round(duration),
      createdAt: new Date().toISOString()
    };

    db.videos.push(video);
    saveDB();
    const payload = publicVideo(video);
    res.json({ ok: true, video: payload });
    emitLibraryUpdate();
    emitVideoChanged(video.id);
  });
});

app.post('/api/videos/:id/comments', authRequired, (req, res) => {
  const video = db.videos.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty' });

  const comment = {
    id: uid('com_'),
    videoId: video.id,
    userId: req.user.id,
    text,
    createdAt: new Date().toISOString()
  };

  db.comments.push(comment);
  saveDB();
  res.json({ ok: true, comment: publicComment(comment) });
  emitLibraryUpdate();
  emitVideoChanged(video.id);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.on('connection', socket => {
  const userId = socket.request.session?.userId;
  socket.on('ping:library', () => socket.emit('library:update'));
  if (userId) socket.emit('library:update');
});

server.listen(PORT, () => {
  console.log(`RetroTube running on http://localhost:${PORT}`);
});
