<p align="center">
  <img src="logo_luno.png" alt="LUNO" height="80" />
</p>

<h1 align="center">LUNO Automation</h1>

<p align="center">
  Bulk-post videos to <b>TikTok</b> and <b>Shopee Video</b> — with product links, scheduling,
  cover images and more — from a desktop app, no code required after setup.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.vi.md">Tiếng Việt</a>
</p>

## Why this exists

- **TikTok has no official API for bulk-posting with a product link attached** (Product Anchor) —
  the official Content Posting API doesn't cover what's needed for this affiliate-selling use case.
- **Manually posting one by one doesn't scale either** — attaching a product link is a multi-step
  UI flow you'd have to repeat by hand hundreds of times.
- **Shopee does have an official API**, but getting it approved and integrated for "bulk-post video
  with product" isn't meaningfully faster than automating the UI — and building one consistent
  Playwright flow for both platforms is simpler than maintaining two very different integrations.

→ The approach: use [Playwright](https://playwright.dev) to drive **your own real, already-installed
  Chrome browser** through the TikTok Studio / Shopee Creator Center web UI, exactly like a human
  would — just automated across many videos. It doesn't bypass or defeat any security mechanism of
  either platform; you still log in yourself (see "Login" below).

## Features

**Shared across both platforms:**
- Log in via a cookie string pasted from your browser (login/QR is intentionally not automated —
  see "Limitations" below)
- Up to 3 saved accounts per platform, quick switching between them
- Two ways to pick videos: filter by a numeric range in the filename, OR browse and hand-pick any
  files via the native file dialog (mix both in the same batch)
- Per-video caption, hashtags (default or custom), schedule (with 4 quick time-slot buttons), and a
  per-video toggle for whether to attach the product link at all
- Save as draft instead of posting for real, if you want to double-check first
- Runs a whole batch in one browser session, live progress log
- The in-progress batch autosaves to disk — closing/reopening the app doesn't lose what you typed,
  and videos already posted successfully are automatically skipped on retry
- "Retry failed videos" button after a batch finishes
- A "⚙ Default settings" screen to change the default caption/hashtags/product ID/music volume/delay
  between posts — no code editing needed

**TikTok only:**
- **Grid Layout** covers — slice one large image into N pieces (3×3 or 3×4), posted in the right
  order so your TikTok profile grid (3 columns) shows the assembled picture
- Product display name: use the default from Seller Center, or type a custom one per video (30
  characters max, TikTok's real limit)
- Per-video background music toggle (random pick from your Favorites, adjustable dB)

**Shopee only:**
- Cover image: pick a frame from the video itself by second — Shopee doesn't support uploading a
  custom cover image like TikTok does
- Product search by name (TikTok searches by ID instead), with an optional exact product ID to
  disambiguate when the name search returns multiple matches

## Default values

This project was originally built for a hair-dryer brand (LUNO) — the sample defaults baked into
the code (sample caption, hashtags, product ID) reflect that. This is just placeholder data and
**doesn't limit the tool to any specific product or niche** — open **"⚙ Default settings"** inside
the app to change them, no code editing required.

## Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│ Electron (frontend/electron) │  spawn  │ FastAPI + Playwright (backend/)   │
│  - Desktop window             │────────▶│  http://127.0.0.1:8756            │
│  - Native file/folder dialogs │        │  - Drives a real Chrome browser   │
└──────────────┬────────────────┘        │  - Runs each batch in its own     │
               │ renders                 │    thread                        │
               ▼                         └──────────────────────────────────┘
┌─────────────────────────────┐
│ React + TypeScript (src/)    │
│  - Multi-step wizard UI,     │
│    talks to the backend via  │
│    fetch/WebSocket           │
└─────────────────────────────┘
```

- **`backend/`** — plain Python (FastAPI + Playwright), no dependency on Electron/Node. Can also run
  standalone via CLI (`python bulk_upload.py`, `python test_shopee_single.py`) without opening the app.
- **`frontend/`** — Electron + React + Vite + TypeScript + Tailwind CSS. UI layer only — no
  automation logic lives here; every Playwright action is in `backend/`.
- The two talk over local HTTP/WebSocket (`127.0.0.1:8756`, never exposed outside your machine).

## Setup (run from source, dev mode)

Requirements: [Node.js](https://nodejs.org) 18+, [Python](https://python.org) 3.11+, and **Google
Chrome** already installed (Playwright uses `channel='chrome'` — it drives your real Chrome, it
doesn't download its own Chromium).

```bash
git clone <repo-url> luno-automation
cd luno-automation

# 1. Backend
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux
pip install -r requirements.txt

# 2. Frontend
cd ../frontend
npm install

# 3. Run in dev mode (from frontend/)
npm run electron:dev
```

First launch: click "+ Add another account" on the Login step and follow the in-app instructions to
grab a cookie string from F12 DevTools. You only need to do this once per account — the session is
saved and reused after that.

## Building an installer (.exe)

```bash
# 1. Bundle the backend into 1 standalone executable (PyInstaller) - the
#    target machine doesn't need Python installed
cd backend
pip install pyinstaller
pyinstaller server.spec

# 2. Package the full app (electron-builder embeds the backend build above
#    via extraResources)
cd ../frontend
npm run electron:build
```

Output: `frontend/release/LUNO Automation Setup <version>.exe` — a standard Windows NSIS installer.
The target machine only needs **Windows + Google Chrome** — no Node, Python, or pip required.

## Limitations to know about

- **TikTok**: max 30 videos in "scheduled" state at once per account, and scheduling only works up
  to 30 days ahead — this is TikTok's own hard limit, not something the app imposes.
- **Manual cookie login is intentional**: TikTok/Shopee scrutinize the login/QR/password step far
  more than actions taken after you're already logged in — automating that step gets flagged easily.
  The app never types a password or clicks a login button for you.
- Selectors were confirmed against real HTML at the time this was written — TikTok/Shopee can change
  their UI at any point, which may require updating a selector or two.
- Use responsibly: automate actions on accounts **you own**, and follow each platform's Terms of
  Service.

## Security & what's not published

This repo deliberately does **not** contain (see `.gitignore`): saved cookies/sessions, the account
list, post logs/history, cropped cover images, private development notes, or the captured HTML used
as a selector reference while building this (which can contain real product/business data). All of
that only ever exists on your own machine once you run the app yourself — none of it ships with the
source code.

## Author

Built by [**TonCD**](https://github.com/TonCD).

## License

[MIT](LICENSE)
