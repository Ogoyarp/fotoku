# Fotoku

Personal photo gallery that proxies Telegram channel photos (MTProto) without storing full-size images on disk.

## Recovery note
Restored from Gemini CLI chat history after `/root/fotoku` was deleted on the VPS.
Core backend files (`server.js`, `sync.js`, `generate-thumbs.js`, `auth.js`, `package.json`) look complete.
Some HTML pages were only partially captured in history and may be incomplete.

## Stack
- Node.js + Express
- teleproto (Telegram MTProto)
- sharp / sharp-phash

## Run
```bash
cp .env.example .env
npm install
node sync.js
node server.js
```
Default port: `3001`.

## Incomplete files in this recovery
- `album.html`, `duplicates.html`, `favorites.html`: only partial head captured
- `lightbox.js`: truncated near end
- `tailwind.js`, `package-lock.json`, runtime data intentionally omitted
