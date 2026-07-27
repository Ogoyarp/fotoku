// generate-thumbs.js — pre-generate semua thumbnail sekali jalan
require('dotenv').config();
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PHOTOS_DIR = './photos';
const THUMB_DIR = './thumbs';

if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR);

const db = JSON.parse(fs.readFileSync('./photos.json', 'utf8'));
const files = [...new Set(db.map(p => p.filename))]; // unik

async function main() {
  let done = 0, skip = 0, fail = 0;
  for (const filename of files) {
    const src = path.join(PHOTOS_DIR, filename);
    const dest = path.join(THUMB_DIR, filename);
    if (!fs.existsSync(src)) { skip++; continue; }
    if (fs.existsSync(dest)) { skip++; continue; }
    try {
      await sharp(src).resize(300, 300, { fit: 'cover' }).jpeg({ quality: 70 }).toFile(dest);
      done++;
      if (done % 50 === 0) console.log(`Progress: ${done}/${files.length - skip} thumbnail dibuat...`);
    } catch (e) {
      fail++;
      // fallback: copy file asli
      try { fs.copyFileSync(src, dest); } catch {}
    }
  }
  console.log(`\nSelesai. Dibuat: ${done}, dilewati: ${skip}, gagal: ${fail}`);
}

main().catch(console.error);
