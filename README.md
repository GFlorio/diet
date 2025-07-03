# Diet

---

## 📋 Project Summary

This repo hosts a **mobile‑first, offline‑first calories/macros tracker**.
The front end is a tiny PWA (Progressive Web App) built with Bootstrap 5 and Vite, storing data locally in IndexedDB via Dexie. A service worker (powered by Google Workbox) queues mutations while offline and flushes them when a connection returns.
The back end is a single Go binary that exposes a REST API, persists data in SQLite, and uses sqlc‑generated, type‑safe data access plus golang‑migrate for schema evolution. Everything lives in one monorepo, with **mise** governing tool versions and task automation.

---

## 1 Architecture at a Glance

```
┌────────────────────────────┐
│      Service Worker        │ ← Workbox background‑sync :contentReference[oaicite:0]{index=0}
└────────────▲───────────────┘
             │ fetch/queue
┌────────────┴───────────────┐
│  Dexie.js (IndexedDB)      │ ← wrapper for fast, async local DB :contentReference[oaicite:1]{index=1}
└────────────▲───────────────┘
             │ JSON payloads
┌────────────┴───────────────┐      push/pull
│   Go REST API (Chi)        │ ──────────────────► SQLite file
│   — sqlc  code‑gen         │                   │  (type‑safe queries)
│   — goose CLI              │ ◄─────────────────┘  (versioned migrations)
└────────────────────────────┘
```

---

## 2 Tech Stack

| Layer             | Choice                      | Rationale                                                                                                      |
| ----------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Build & Tasks** | `mise`                      | One tool controls Go, Node, sqlc, goose, etc. and runs tasks cross‑platform.                                   |
| **Front End**     | Vite 5 + Bootstrap 5 (Sass) | Vite’s ESBuild core gives instant HMR and tree‑shakes Bootstrap’s ESM modules.                                 |
|                   | Dexie 4 + IndexedDB         | Minimal wrapper for async IndexedDB; ideal for offline caches.                                                 |
|                   | Google Workbox              | Handles runtime caching and Background Sync retries automatically.                                             |
| **Back End**      | Go                          | Small static binary, fast, easy to cross‑compile.                                                              |
|                   | sqlc                        | Generates Go structs and methods from handwritten SQL, catching mistakes at compile time.                      |
|                   | SQLite (modernc driver)     | Single‑file DB, zero external service, CGO‑free builds.                                                        |
|                   | goose                       | Battle‑tested migration CLI/SDK, SQLite driver included.                                                       |
| **PWA Core**      | Service workers             | Intercept requests & serve cached assets offline.                                                              |

---

## 3 Repository Layout

```
.
├─ cmd/
│   └─ server/
│       └─ main.go
├─ internal/
│   ├─ api/
│   └─ db/          # sqlc-generated
├─ db/
│   ├─ migrations/  # goose
│   └─ queries/     # handwritten *.sql for sqlc
├─ frontend/
├─ go.mod
├─ sqlc.yaml
├─ Dockerfile
└─ .mise.toml
```

---
---

## 5 Local Development Workflow

```bash
# one‑time
mise install            # installs Go, Node, sqlc, migrate, etc.

# run everything
mise run dev            # Vite dev server + hot‑reloading API

# generate typed DB code after editing SQL
mise run sqlc

# apply new migrations
mise run db.up
```

SQLite is opened with `db.SetMaxOpenConns(1)` to respect the single‑writer model, avoiding corruption on concurrent writes. ([go.dev][8])

---

## 6 Offline & Sync Details

1. **Write‑through cache**: all edits hit Dexie first; each mutation gets a UUID and `updated_at` timestamp.
2. **Background sync**: Workbox queues failed POSTs and replays them when the browser fires a `sync` event. ([developer.chrome.com][4])
3. **Catch‑up API**: `GET /catchup?since=ts&limit=n` streams JSON deltas; client merges them into IndexedDB.
4. **Storage quota check**: before large inserts, `navigator.storage.estimate()` warns users if usage >80 %. ([developer.mozilla.org][9])

---

## 7 Bootstrap Optimizations

* Import only needed Sass partials (`grid`, `forms`, `buttons`…), keeping the raw CSS tiny. ([getbootstrap.com][10])
* Tree‑shaken JS: Vite drops components you don’t `import`. ([getbootstrap.com][2])
* PurgeCSS (integrated in Vite) strips unused selectors; tests show <10 KB final CSS. ([getbootstrap.com][2])

---

## 8 Migration & Data Access

* **sqlc** watches `backend/db/queries/*.sql` and emits Go methods in `internal/db/`. All queries are validated at compile time, eliminating runtime SQL typos. ([docs.sqlc.dev][5])
* **golang‑migrate** keeps a `schema_migrations` table inside the same SQLite file and can run from CI/CD. ([github.com][11])

---

## 9 Deployment Notes

* The back‑end binary is CGO‑free (modernc driver) and can be scratch‑ or distroless‑containerized for sub‑10 MB images.
* Front‑end assets are static: `dist/` is <50 KB (Brotli) after Vite build and Bootstrap stripping.
* For quick self‑hosting, run `docker compose up`—one service for `server`, one for `nginx` static files.

---
