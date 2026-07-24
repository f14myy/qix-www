# Qix

Lightweight mobile-first messenger built with SvelteKit, SQLite, and SSE.

## Setup

```sh
pnpm install
pnpm dev
```

Open the app on your phone (same Wi‑Fi) via the LAN URL Vite prints, or use browser mobile mode.

## Features

- Username (3–9 English letters/digits) + password auth
- 1:1 chats with realtime delivery (SSE)
- Photo/file attachments (up to 10 MB)

Data is stored in `data/qix.db` and uploads in `data/uploads/`.
