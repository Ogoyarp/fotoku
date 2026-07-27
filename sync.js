// sync.js — ambil metadata foto dari channel, TANPA download ke disk
require('dotenv').config();
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const input = require('input');
const fs = require('fs');

const SESSION_FILE = './session.txt';
const DB_FILE = './photos.json';
const CHAT_IDS_FILE = './chat_ids.json';

function loadDb() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

async function main() {
  const sessionStr = fs.existsSync(SESSION_FILE)
    ? fs.readFileSync(SESSION_FILE, 'utf8').trim() : '';

  const session = new StringSession(sessionStr);
  const client = new TelegramClient(session, parseInt(process.env.API_ID), process.env.API_HASH, {
    connectionRetries: 5,
  });

  if (sessionStr) {
    await client.connect();
  } else {
    await client.start({
      phoneNumber: async () => process.env.PHONE,
      password: async () => input.text('2FA password: '),
      phoneCode: async () => input.text('Kode OTP: '),
      onError: err => console.error(err),
    });
    fs.writeFileSync(SESSION_FILE, client.session.save());
    console.log('Login berhasil, session disimpan.');
  }

  const db = loadDb();
  const existingIds = new Set(db.map(p => `${p.channel_id || process.env.CHANNEL_ID}:${p.message_id}`));

  const allChannels = [process.env.CHANNEL_ID];
  if (fs.existsSync(CHAT_IDS_FILE)) {
    try {
      const extra = JSON.parse(fs.readFileSync(CHAT_IDS_FILE, 'utf8'));
      extra.forEach(id => { if (!allChannels.includes(id)) allChannels.push(id); });
    } catch {}
  }

  let totalNew = 0;

  for (const channelId of allChannels) {
    console.log(`\nSync metadata channel: ${channelId}...`);
    let count = 0;

    for await (const message of client.iterMessages(channelId, { limit: null })) {
      if (!message.photo) continue;
      const uid = `${channelId}:${message.id}`;
      if (existingIds.has(uid)) continue;

      // Ambil file_id dari ukuran terbesar (untuk proxy) dan terkecil (untuk thumb)
      const sizes = message.photo.sizes || [];
      const largest = sizes.filter(s => s.size).sort((a, b) => b.size - a.size)[0];
      const smallest = sizes.filter(s => s.size).sort((a, b) => a.size - b.size)[0];

      db.push({
        message_id: message.id,
        channel_id: channelId,
        date: message.date,
        caption: message.message || '',
        // file_id untuk Bot API proxy
        file_id: largest?.fileReference ? null : null, // Bot API pakai access_hash
        // Simpan photo id untuk dipakai MTProto proxy
        photo_id: message.photo.id?.toString(),
        access_hash: message.photo.accessHash?.toString(),
        file_reference: message.photo.fileReference
          ? Buffer.from(message.photo.fileReference).toString('base64') : null,
        // Ukuran untuk thumb (type 's' atau 'm')
        thumb_type: smallest?.type || 's',
        // Ukuran asli
        width: message.photo.sizes?.find(s => s.w)?.w || 0,
        height: message.photo.sizes?.find(s => s.h)?.h || 0,
      });

      existingIds.add(uid);
      count++;
      totalNew++;

      if (count % 50 === 0) {
        db.sort((a, b) => b.date - a.date);
        saveDb(db);
        console.log(`  ${count} metadata tersimpan...`);
      }
    }

    console.log(`  Selesai: ${count} foto baru dari ${channelId}`);
  }

  db.sort((a, b) => b.date - a.date);
  saveDb(db);
  console.log(`\nSync selesai. ${totalNew} baru, total ${db.length}`);
  await client.disconnect();
}

main().catch(console.error);
