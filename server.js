// server.js — proxy Telegram, tidak simpan foto di disk
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const phash = require('sharp-phash');
const dist = require('sharp-phash/distance');
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');

const app = express();
app.use(express.json());

// ── Auth server-side ─────────────────────────────────────────────────────────
// ponytail: session in-memory (Map) — restart server = semua logout.
// Upgrade ke file/DB kalau butuh persist antar restart.
const crypto = require('crypto');
const AUTH_EMAIL = process.env.AUTH_EMAIL;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const sessions = new Map(); // token -> expiry (ms)
const SESSION_MAX_AGE = 30 * 24 * 3600 * 1000; // 30 hari

function parseCookies(req) {
  const h = req.headers.cookie || '';
  const out = {};
  h.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function safeEq(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function sessionFrom(req) {
  const token = parseCookies(req)['fotoku_session'];
  const exp = token && sessions.get(token);
  return (exp && exp > Date.now()) ? token : null;
}

app.post('/api/login', (req, res) => {
  if (!AUTH_EMAIL || !AUTH_PASSWORD) {
    return res.status(500).json({ error: 'Auth belum dikonfigurasi. Isi AUTH_EMAIL dan AUTH_PASSWORD di .env' });
  }
  const { email, password } = req.body || {};
  if (!safeEq(email, AUTH_EMAIL) || !safeEq(password, AUTH_PASSWORD)) {
    return res.status(401).json({ error: 'Email atau password salah.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_MAX_AGE);
  res.setHeader('Set-Cookie',
    `fotoku_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE / 1000}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req)['fotoku_session'];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'fotoku_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ authenticated: !!sessionFrom(req) }));

// Semua /api/* lainnya wajib login (login/logout/me dikecualikan di atas)
app.use('/api', (req, res, next) => {
  if (sessionFrom(req)) return next();
  res.status(401).json({ error: 'Unauthorized' });
});

const DB_FILE      = path.join(__dirname, 'photos.json');
const CHAT_IDS_FILE = path.join(__dirname, 'chat_ids.json');
const SESSION_FILE  = path.join(__dirname, 'session.txt');
const THUMB_DIR     = path.join(__dirname, 'thumbs'); // hanya thumbnail kecil
const BOT_TOKEN    = process.env.BOT_TOKEN;
const PORT         = parseInt(process.env.PORT) || 3001;

if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR);

// ── DB helpers ──────────────────────────────────────────────────────────────
function loadDb() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ── Chat IDs helpers ─────────────────────────────────────────────────────────
function loadChatIds() {
  const base = process.env.CHANNEL_ID ? [process.env.CHANNEL_ID] : [];
  if (!fs.existsSync(CHAT_IDS_FILE)) return base;
  try {
    const extra = JSON.parse(fs.readFileSync(CHAT_IDS_FILE, 'utf8'));
    return [...new Set([...base, ...extra])];
  } catch { return base; }
}
function saveExtraChatIds(ids) {
  fs.writeFileSync(CHAT_IDS_FILE, JSON.stringify(ids, null, 2));
}

// ── Telegram client (singleton untuk proxy) ──────────────────────────────────
let tgClient = null;
async function getTgClient() {
  if (tgClient && tgClient.connected) return tgClient;
  const sessionStr = fs.existsSync(SESSION_FILE)
    ? fs.readFileSync(SESSION_FILE, 'utf8').trim() : '';
  if (!sessionStr) throw new Error('Session tidak ada, jalankan node sync.js dulu');
  tgClient = new TelegramClient(new StringSession(sessionStr), parseInt(process.env.API_ID), process.env.API_HASH, { connectionRetries: 3 });
  await tgClient.connect();
  return tgClient;
}

// ── Fetch foto via Bot API (untuk webhook foto baru) ─────────────────────────
function botApiGetFilePath(file_id) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${file_id}`, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        const j = JSON.parse(d);
        j.ok ? resolve(j.result.file_path) : reject(new Error(j.description));
      });
    }).on('error', reject);
  });
}

// ── Proxy gambar dari Telegram ke response ────────────────────────────────────
function proxyTelegramUrl(telegramUrl, res) {
  https.get(telegramUrl, tgRes => {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    tgRes.pipe(res);
  }).on('error', () => res.status(502).end());
}

// ── API foto: thumbnail (dari cache, di-generate saat sync) ───────────────────
app.get('/thumb/:id', async (req, res) => {
  const id = req.params.id;
  const cached = path.join(THUMB_DIR, `${id}.jpg`);

  // Sudah ada cache → langsung serve
  if (fs.existsSync(cached)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Content-Type', 'image/jpeg');
    return fs.createReadStream(cached).pipe(res);
  }

  // Belum ada cache → generate on-demand (fallback)
  const db = loadDb();
  const photo = db.find(p => String(p.message_id) === String(id) || `${p.channel_id}_${p.message_id}` === id);
  if (!photo) return res.status(404).end();

  try {
    const client = await getTgClient();
    const channelId = photo.channel_id || process.env.CHANNEL_ID;
    const message = await client.getMessages(channelId, { ids: photo.message_id });
    if (!message?.[0]?.photo) return res.status(404).end();

    const buffer = await client.downloadMedia(message[0], { thumb: 1 });
    if (!buffer) return res.status(502).end();

    const resized = await sharp(buffer).resize(300, 300, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer();
    fs.writeFileSync(cached, resized);

    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Content-Type', 'image/jpeg');
    res.end(resized);
  } catch (e) {
    console.error('Thumb error:', e.message);
    res.status(502).end();
  }
});

// ── API foto: fullsize (proxy langsung dari Telegram, tidak disimpan) ─────────
app.get('/photo/:id', async (req, res) => {
  const id = req.params.id;
  const db = loadDb();
  const photo = db.find(p => String(p.message_id) === String(id) || `${p.channel_id}_${p.message_id}` === id);
  if (!photo) return res.status(404).end();

  try {
    const client = await getTgClient();
    const channelId = photo.channel_id || process.env.CHANNEL_ID;
    const message = await client.getMessages(channelId, { ids: photo.message_id });
    if (!message?.[0]?.photo) return res.status(404).end();

    const buffer = await client.downloadMedia(message[0]);
    if (!buffer) return res.status(502).end();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(buffer);
  } catch (e) {
    console.error('Photo proxy error:', e.message);
    res.status(502).end();
  }
});

// ── API: list foto ────────────────────────────────────────────────────────────
app.get('/api/photos', (req, res) => {
  const db = loadDb();
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 9999;
  const start = (page - 1) * limit;
  const items = db.slice(start, start + limit);
  res.json({
    total: db.length, page, limit,
    photos: items.map(p => {
      const uid = `${p.channel_id || process.env.CHANNEL_ID}_${p.message_id}`;
      return { ...p, thumb_url: `/thumb/${uid}`, url: `/photo/${uid}` };
    }),
  });
});

// ── API: albums ───────────────────────────────────────────────────────────────
app.get('/api/albums', async (req, res) => {
  const db = loadDb();
  const chatIds = loadChatIds();

  // Ambil nama channel via MTProto
  let channelNames = {};
  try {
    const client = await getTgClient();
    for (const channelId of chatIds) {
      try {
        const entity = await client.getEntity(channelId);
        channelNames[channelId] = entity.title || entity.username || channelId;
      } catch { channelNames[channelId] = channelId; }
    }
  } catch { chatIds.forEach(id => channelNames[id] = id); }

  const albums = chatIds.map(channelId => {
    const photos = db.filter(p => (p.channel_id || process.env.CHANNEL_ID) === channelId);
    const cover = photos[0];
    const uid = cover ? `${cover.channel_id || process.env.CHANNEL_ID}_${cover.message_id}` : null;
    return { channel_id: channelId, name: channelNames[channelId] || channelId, count: photos.length, cover_url: uid ? `/thumb/${uid}` : null };
  }).filter(a => a.count > 0);

  res.json({ albums });
});

// ── API: love/unlove foto ─────────────────────────────────────────────────────
app.post('/api/love/:channelId/:messageId', (req, res) => {
  const db = loadDb();
  const p = db.find(p => String(p.message_id) === req.params.messageId && String(p.channel_id) === req.params.channelId);
  if (!p) return res.status(404).json({ ok: false });
  p.loved = !p.loved;
  saveDb(db);
  res.json({ ok: true, loved: p.loved });
});

app.get('/api/favorites', (req, res) => {
  const db = loadDb();
  const photos = db.filter(p => p.loved);
  res.json({
    total: photos.length,
    photos: photos.map(p => {
      const uid = `${p.channel_id}_${p.message_id}`;
      return { ...p, thumb_url: `/thumb/${uid}`, url: `/photo/${uid}` };
    }),
  });
});

// ── API: duplicates ───────────────────────────────────────────────────────────
app.get('/api/duplicates', async (req, res) => {
  const db = loadDb();
  const THRESHOLD = 8; // jarak hash <= 8 dianggap duplikat (0=identik, max 64)

  // Hanya proses foto yang sudah ada thumbnail-nya
  const withHash = [];
  for (const p of db) {
    const uid = `${p.channel_id || process.env.CHANNEL_ID}_${p.message_id}`;
    const thumbPath = path.join(THUMB_DIR, `${uid}.jpg`);
    if (!fs.existsSync(thumbPath)) continue;

    if (!p.phash) {
      try {
        p.phash = await phash(thumbPath);
      } catch { continue; }
    }
    withHash.push({ ...p, uid });
  }

  // Simpan hash ke DB agar tidak perlu hitung ulang
  saveDb(db);

  // Kelompokkan duplikat
  const used = new Set();
  const groups = [];

  for (let i = 0; i < withHash.length; i++) {
    if (used.has(withHash[i].uid)) continue;
    const group = [withHash[i]];
    used.add(withHash[i].uid);

    for (let j = i + 1; j < withHash.length; j++) {
      if (used.has(withHash[j].uid)) continue;
      if (dist(withHash[i].phash, withHash[j].phash) <= THRESHOLD) {
        group.push(withHash[j]);
        used.add(withHash[j].uid);
      }
    }

    if (group.length > 1) {
      groups.push(group.map(p => ({
        message_id: p.message_id,
        channel_id: p.channel_id,
        date: p.date,
        caption: p.caption,
        thumb_url: `/thumb/${p.uid}`,
        url: `/photo/${p.uid}`,
      })));
    }
  }

  res.json({ total: groups.reduce((s, g) => s + g.length, 0), groups });
});

app.get('/api/albums/:channelId/photos', (req, res) => {
  const db = loadDb();
  const channelId = req.params.channelId;
  const photos = db.filter(p => (p.channel_id || process.env.CHANNEL_ID) === channelId);
  res.json({
    channel_id: channelId, total: photos.length,
    photos: photos.map(p => {
      const uid = `${p.channel_id || channelId}_${p.message_id}`;
      return { ...p, thumb_url: `/thumb/${uid}`, url: `/photo/${uid}` };
    }),
  });
});

// ── API: chat IDs ─────────────────────────────────────────────────────────────
app.get('/api/chat-ids', (req, res) => res.json({ ids: loadChatIds() }));
app.post('/api/chat-ids', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids harus array' });
  saveExtraChatIds(ids.filter(id => id !== process.env.CHANNEL_ID));
  res.json({ ok: true, ids: loadChatIds() });
});

// ── API: sync ─────────────────────────────────────────────────────────────────
let syncRunning = false;
let syncLog = [];

async function runSync() {
  if (syncRunning) return;
  syncRunning = true;
  syncLog = ['Menghubungi Telegram...'];
  try {
    const client = await getTgClient();
    const db = loadDb();
    const existingIds = new Set(db.map(p => `${p.channel_id || process.env.CHANNEL_ID}:${p.message_id}`));
    const allChannels = loadChatIds();
    let totalNew = 0;

    for (const channelId of allChannels) {
      syncLog.push(`Sync channel ${channelId}...`);
      let count = 0;
      for await (const message of client.iterMessages(channelId, { limit: null })) {
        if (!message.photo) continue;
        const uid = `${channelId}:${message.id}`;
        if (existingIds.has(uid)) continue;

        // Simpan metadata
        db.push({
          message_id: message.id,
          channel_id: channelId,
          date: message.date,
          caption: message.message || '',
        });
        existingIds.add(uid);
        count++; totalNew++;

        // Download + cache thumbnail (kecil, ~5-15KB)
        try {
          const thumbId = `${channelId}_${message.id}`;
          const cached = path.join(THUMB_DIR, `${thumbId}.jpg`);
          if (!fs.existsSync(cached)) {
            const buffer = await client.downloadMedia(message, { thumb: 1 });
            if (buffer) {
              const resized = await sharp(buffer).resize(300, 300, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer();
              fs.writeFileSync(cached, resized);
            }
          }
        } catch {} // jangan stop sync kalau thumb gagal

        if (count % 50 === 0) {
          db.sort((a, b) => b.date - a.date);
          saveDb(db);
          syncLog.push(`  ${channelId}: ${count} foto...`);
        }
      }
      syncLog.push(`Selesai: ${count} foto baru dari ${channelId}`);
    }

    db.sort((a, b) => b.date - a.date);
    saveDb(db);
    syncLog.push(`✓ Selesai. ${totalNew} foto baru, total ${db.length}`);
  } catch (e) {
    syncLog.push(`ERROR: ${e.message}`);
  } finally {
    syncRunning = false;
  }
}

app.post('/api/sync', (req, res) => {
  if (syncRunning) return res.json({ ok: false, message: 'Sync sedang berjalan...' });
  runSync();
  res.json({ ok: true, message: 'Sync dimulai' });
});
app.get('/api/sync/status', (req, res) => res.json({ running: syncRunning, log: syncLog.slice(-5) }));

// ── Webhook foto baru dari Telegram ──────────────────────────────────────────
app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  res.sendStatus(200);
  const msg = req.body.channel_post || req.body.message;
  if (!msg?.photo) return;
  const allowedIds = loadChatIds().map(String);
  if (!allowedIds.includes(String(msg.chat.id))) return;

  const db = loadDb();
  const channelId = String(msg.chat.id);
  if (db.find(p => p.message_id === msg.message_id && p.channel_id === channelId)) return;

  db.unshift({ message_id: msg.message_id, channel_id: channelId, date: msg.date, caption: msg.caption || '' });
  saveDb(db);
  console.log(`Foto baru dari webhook: channel=${channelId} msg=${msg.message_id}`);
});

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    // Cache lebih lama untuk asset yang jarang berubah
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 hari
    }
  }
}));

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  console.log('Webhook: terdaftar (URL tersembunyi dari log, cek config Telegram langsung)');
});
