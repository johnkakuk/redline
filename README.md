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

## Install on iPhone

Deploy `dist/` to any HTTPS static host on a stable origin (e.g. Cloudflare Pages: build `npm run build`, output `dist`). Open it in Safari, then Share → Add to Home Screen. Changing the origin later strands local data, so export first (Settings → Export backup).

## How it fits together

- **`src/engine/`**: pure logic with no I/O: double progression, e1RM, calories, PRs, volume, warm-ups. Fully unit-tested.
- **`src/db/`**: SQLite (`@sqlite.org/sqlite-wasm`, `opfs-sahpool` VFS) in a dedicated worker. Repos are synchronous functions over a `Db` handle; `api.ts` binds them and the worker exposes them over Comlink. The UI calls `db.someRepoFn()` and never writes SQL. The same repos run in Node tests against in-memory SQLite.
- **`src/features/`**: screens. TanStack Query reads; `act()` runs a write and refreshes queries. The live workout updates set rows optimistically.
- **`src/ui/`**: design-system components on top of `src/styles/tokens.css`.

Weights are stored in kg and converted at the UI edge. Every table has ULID ids, `updated_at` triggers and soft deletes, so the schema is ready for the cloud mirror (PLAN §10).

If OPFS is unavailable (Safari private browsing, or another tab holding the database), the app runs in memory and shows a "not saving" warning.

## Not built yet

Phases 9–10 (Supabase mirror and the Cloudflare Worker MCP connector for AI drafts) need your Cloudflare and Supabase projects.
