# Redline

Personal workout tracker. An offline-first PWA for the iPhone home screen. Spec: [assets/PLAN.md](assets/PLAN.md), design: [assets/DESIGN.md](assets/DESIGN.md).

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # engine + repo tests (Vitest, real SQLite in Node)
npm run e2e        # Playwright: WebKit/iPhone flows, offline, OPFS persistence
npm run build      # typecheck + production build in dist/
```

The first `npm run e2e` needs `npx playwright install webkit chromium`.

## Live

https://redline.john-24f.workers.dev. One Cloudflare Worker serves the PWA (static assets) and `/api`.

- **`/`** is the public app. Everything lives on the device; no account needed. Share it with anyone.
- **`/login`** is for invited accounts (email code / magic link, or password). Logged-in users get cloud backup and sync; AI features will also require login.

Install: open it in Safari → Share → Add to Home Screen.

## Deploy

```sh
npm run deploy                      # build + wrangler deploy
npm run db:push                     # apply supabase/migrations to the cloud database
npm run invite -- friend@example.com   # allow an email to create an account
```

Secrets live outside git: `.env.local` (DB password, project ref) and the Worker secret `SUPABASE_SECRET_KEY` (`wrangler secret put`). `.env` holds only the public Supabase URL and publishable key.

## How it fits together

- **`src/engine/`**: pure logic with no I/O: double progression, e1RM, calories, PRs, volume, warm-ups. Fully unit-tested.
- **`src/db/`**: SQLite (`@sqlite.org/sqlite-wasm`, `opfs-sahpool` VFS) in a dedicated worker. Repos are synchronous functions over a `Db` handle, exposed to the UI over Comlink. The same repos run in Node tests against in-memory SQLite.
- **`src/features/`**: screens. TanStack Query reads; `act()` runs a write, refreshes queries and nudges sync.
- **`src/sync/`, `worker/`, `supabase/`**: cloud backup for logged-in users. The phone stays the source of truth and pushes every row newer than its last push (all tables have `updated_at` triggers and soft deletes, so no outbox is needed). The Worker checks the Supabase session and calls `sync_push`, which upserts last-write-wins and forces `user_id` to the caller. Cloud tables are keyed `(user_id, id)` with RLS on and no public access. Only invited emails (`allowed_emails`) can create accounts; a database trigger enforces it. Seeded exercises have deterministic ids so devices merge cleanly.
- On login, a fresh device takes the account's cloud copy; a device already in use pushes, then merges.

When the SQLite schema changes, add a matching Supabase migration (new columns are otherwise dropped on push).

If OPFS is unavailable (Safari private browsing, or another tab holding the database), the app runs in memory and shows a "not saving" warning.

## Not built yet

The MCP connector for AI drafts (PLAN phase 10). The `ai_drafts` table is already in place.
