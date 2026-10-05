# REDLINE — Personal Workout Tracker (Build Plan)

> Working name. Single-user, offline-first PWA installed to the iPhone home screen via Safari.
> Hand this file, `DESIGN.md`, and `tokens.css` to Claude Code. Build in the phase order at the bottom.

---

## 1. Product summary

A fast, dark, gym-floor-friendly tracker in the spirit of Beastly/BeastNation (routine-driven logging) and WHOOP (dense, data-forward analytics). One user, no accounts, all data on-device.

**Core loop:** pick routine → app pre-fills every set with a suggested weight × reps → tap to complete sets (rest timer auto-starts) → finish → app computes next session's targets.

### Decisions locked in

| Area | Decision |
|---|---|
| Platform | PWA, iOS Safari home-screen app, dark mode only (v1) |
| Storage | Local-first. SQLite (WASM) in a Web Worker is the source of truth. Supabase (private, single-user) holds a cloud mirror + AI inbox |
| AI | Claude/ChatGPT MCP connector on a Cloudflare Worker (same pattern as the Bridger proposal tool). AI reads your context and drafts routines; you approve them in the app. Never deletes |
| Progression | Double progression by default, with manual override + pin |
| Equipment limits | Simple max-load cap + increment per exercise (overridable per routine item) |
| At the cap | Suggest a linked harder variation |
| Live logging | Rest timer, warm-up sets, supersets/circuits, estimated calorie burn |
| Analytics | Strength trends + PRs, volume by muscle group, consistency |
| Health data | Bodyweight + daily calories/protein |
| Units | lb default, kg toggle (stored internally in kg — see §4) |
| Library | Seeded with ~80 common exercises, fully editable |

### Out of scope for v1
Multi-user accounts, full bidirectional multi-device sync (mirror is one-way up + inbox down; see §10), Apple Health integration (not possible from a PWA), progress photos, body measurements, food database, social features, light mode.

---

## 2. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Build | Vite + React 18 + TypeScript (strict) | |
| Routing | React Router (hash or memory router is fine; app is installed) | |
| PWA | `vite-plugin-pwa` (Workbox, `generateSW`, precache everything) | Must work 100% offline after first load |
| Database | `@sqlite.org/sqlite-wasm` using the **`opfs-sahpool` VFS** inside a dedicated Web Worker | `opfs-sahpool` does not need COOP/COEP headers and works on iOS Safari 16.4+. Main thread talks to the worker via a small typed RPC (Comlink is fine) |
| Data layer | Repository modules (`exercises.repo.ts`, etc.) over raw SQL or Drizzle (`sqlite-proxy` driver) | UI never writes SQL directly. Keeps a storage swap (e.g. to Dexie) possible if iOS OPFS misbehaves |
| Migrations | Numbered SQL files run on worker boot, tracked in `schema_migrations` | |
| State | TanStack Query for reads/invalidations + a small Zustand store for the active workout | Active workout persisted to DB on every set change (crash-safe) |
| Charts | Hand-rolled SVG components (line, bar, heatmap, ring) | Small bundle, full control over the design system. uPlot acceptable for the e1RM line if needed |
| Styling | CSS Modules or vanilla CSS consuming `tokens.css` custom properties | No Tailwind needed; tokens are the contract |
| Fonts | System UI (SF Pro via `-apple-system`) + **Barlow Condensed** self-hosted (woff2, precached) for numerals | No network fonts — offline |
| Tests | Vitest for engine/repo logic, Playwright (WebKit) for key flows | Progression engine and calorie math must be 100% unit-tested |
| IDs | ULIDs (sortable, sync-safe) | |

### Project structure
```
src/
  app/            routes, layout, tab bar
  features/
    today/
    workout/      live session, rest timer, finish summary
    routines/     list + editor
    exercises/    library + detail
    progress/     analytics screens
    body/         weight + nutrition
    settings/
  engine/         progression.ts, e1rm.ts, calories.ts, prs.ts, volume.ts  (pure, no I/O)
  db/
    worker.ts     sqlite-wasm boot + RPC
    migrations/   001_init.sql …
    repos/
    seed/exercises.json
  ui/             design-system components (Button, SetRow, Sheet, Stepper, Keypad…)
  styles/tokens.css
  shared/schemas/ Zod schemas shared with the Worker (drafts, sync payloads)
worker/           Cloudflare Worker: /api (sync, inbox) + /mcp (AI connector)
supabase/         SQL migrations for the cloud mirror + ai_drafts
```

---

## 3. iOS PWA requirements (don't skip)

- `manifest.webmanifest`: `display: standalone`, `background_color` and `theme_color` = `#0A0A0B`, icons 192/512 + maskable.
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- `apple-touch-icon` (180×180), `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style=black-translucent`.
- Respect safe areas: `env(safe-area-inset-top|bottom)` on header and tab bar.
- All inputs ≥16px font-size (prevents iOS zoom). Use `inputmode="decimal"` / `"numeric"`. Prefer the custom keypad sheet for set entry.
- Call `navigator.storage.persist()` on first launch; show storage status in Settings.
- Home-screen web apps have their own storage container and aren't subject to Safari's 7-day eviction, but data can still be lost if the app is deleted from the home screen. **Ship JSON export/import in v1 anyway** as a safety net until sync exists (cheap, see §9).
- **Rest timer is timestamp-based** (`endsAt`), never a decrementing counter — JS is suspended when the app is backgrounded. On return, recompute remaining time.
- No Vibration API on iOS. Timer completion = visual flash + short audio cue (Web Audio, unlocked on first tap). Local notifications aren't available without a push server; note it in the UI ("Keep app open for timer alert").
- Screen Wake Lock API during an active workout (supported in recent iOS; feature-detect, fail silently).
- Disable pull-to-refresh/overscroll bounce on the workout screen (`overscroll-behavior: none`).

---

## 4. Data model (SQLite)

**Sync-ready conventions on every table:** `id TEXT PRIMARY KEY` (ULID), `created_at`, `updated_at` (ISO UTC ms), `deleted_at` nullable (soft delete; nothing is hard-deleted). Add `updated_at` triggers. Weights stored in **kg as REAL**; convert at the UI edge. Increments/caps entered in the user's unit are converted on save and rounded on display so 50 lb never shows as 49.9.

```sql
settings (single row, id='me')
  units TEXT CHECK (units IN ('lb','kg')) DEFAULT 'lb'
  sex TEXT, birth_date TEXT, height_cm REAL
  default_rest_sec INTEGER DEFAULT 90
  calorie_intensity TEXT DEFAULT 'moderate'   -- light|moderate|vigorous
  protein_target_g INTEGER, calorie_target INTEGER
  default_increment_json TEXT  -- per equipment type, e.g. {"dumbbell":2.27,"barbell":2.27,...}

exercises
  name TEXT, primary_muscle TEXT, secondary_muscles TEXT (JSON array)
  equipment TEXT   -- barbell|dumbbell|kettlebell|cable|machine|bodyweight|band|other
  load_type TEXT   -- total | per_hand | bodyweight | bodyweight_plus
  default_increment_kg REAL
  max_load_kg REAL NULL           -- the equipment cap ("I only have 50 lb DBs")
  harder_variation_id TEXT NULL REFERENCES exercises(id)
  easier_variation_id TEXT NULL REFERENCES exercises(id)
  default_rest_sec INTEGER NULL
  notes TEXT, is_seeded INTEGER, archived INTEGER

routines
  name TEXT, notes TEXT, sort_order INTEGER, archived INTEGER

routine_items
  routine_id, exercise_id, sort_order INTEGER
  group_id TEXT NULL              -- shared value = superset/circuit
  working_sets INTEGER, rep_min INTEGER, rep_max INTEGER
  warmup_sets INTEGER DEFAULT 0
  rest_sec INTEGER NULL
  progression_mode TEXT DEFAULT 'double'  -- double|none
  increment_kg REAL NULL          -- overrides exercise default
  max_load_kg REAL NULL           -- overrides exercise cap
  notes TEXT

progression_state                 -- one row per routine_item
  routine_item_id UNIQUE
  target_weight_kg REAL NULL
  target_reps_json TEXT           -- per-set rep targets, e.g. [10,10,9]
  status TEXT                     -- progressing|holding|capped|deload_suggested|variation_suggested
  fail_streak INTEGER DEFAULT 0
  pinned INTEGER DEFAULT 0        -- manual override freeze
  last_evaluated_workout_id TEXT

workouts
  routine_id NULL, name TEXT
  started_at, ended_at NULL, active_duration_sec INTEGER
  bodyweight_kg REAL NULL         -- snapshot at start
  kcal_estimate REAL NULL, notes TEXT
  status TEXT                     -- active|completed|discarded

workout_exercises
  workout_id, exercise_id, routine_item_id NULL
  sort_order, group_id NULL, notes

sets
  workout_exercise_id, sort_order
  kind TEXT                       -- warmup|working
  weight_kg REAL NULL, reps INTEGER NULL
  suggested_weight_kg REAL NULL, suggested_reps INTEGER NULL
  overridden INTEGER DEFAULT 0    -- user changed from suggestion
  completed_at TEXT NULL

personal_records                  -- materialized; rebuildable from sets
  exercise_id, type TEXT          -- max_weight|best_e1rm|reps_at_weight|session_volume
  value REAL, weight_kg REAL NULL, reps INTEGER NULL
  set_id NULL, workout_id, achieved_at

body_weight   (date TEXT, weight_kg REAL, note TEXT)          -- multiple per day allowed; charts use daily latest
nutrition_day (date TEXT UNIQUE, calories INTEGER, protein_g INTEGER)
```

**Muscle groups** (constant enum, not a table): chest, upper_back, lats, traps, front_delts, side_delts, rear_delts, biceps, triceps, forearms, abs, obliques, lower_back, glutes, quads, hamstrings, adductors, calves.

**Indexes:** `sets(workout_exercise_id)`, `workout_exercises(exercise_id, workout_id)`, `workouts(started_at)`, `body_weight(date)`.

---

## 5. Progression engine (`src/engine/progression.ts`)

Pure function. Input: routine item config, effective cap/increment, current state, and the completed working sets from the latest session. Output: new state + human-readable reason string (shown on the finish summary: "Hit 12/12/12 → +5 lb next time").

### Effective parameters
- `increment = routine_item.increment_kg ?? exercise.default_increment_kg ?? settings.default_increment[equipment]`
- `cap = routine_item.max_load_kg ?? exercise.max_load_kg ?? ∞`
- All suggested weights are rounded **down** to a multiple of `increment` and **never exceed `cap`**.

### Rules (evaluated on workout finish, working sets only; warm-ups ignored)
1. **No history** → no suggestion; user enters the first weight. That session becomes the baseline.
2. **Success** = every working set completed at ≥ target weight with reps ≥ `rep_max`.
   - `next = target + increment`.
   - If `next ≤ cap` → weight = next, rep targets reset to `rep_min`, status `progressing`, fail_streak 0.
   - If `next > cap` → weight stays at cap, status `capped`:
     - If `harder_variation_id` set → status `variation_suggested`. Finish summary + next session show a card: "You've maxed out 50 lb DBs on Incline DB Press. Swap to Deficit DB Press?" **Accept** replaces the routine item's exercise (keeps sets/rep range), starting weight = last logged weight for the new exercise, else empty for user to fill. **Dismiss** holds at cap and asks again after 2 more capped sessions.
     - If no variation linked → hold at cap, show "Capped" badge and a prompt to link a harder variation or raise the cap.
3. **Partial** = all sets ≥ `rep_min` but not all at `rep_max` → hold weight; per-set rep target = `min(last_reps + 1, rep_max)`. Status `holding`. fail_streak 0.
4. **Miss** = any working set below `rep_min` (at target weight) → hold weight, fail_streak + 1. At fail_streak 3 → status `deload_suggested`, suggest `floor_to_increment(target × 0.9)`; user accepts or dismisses. Reset streak either way.
5. **User trained lighter than target** (manual override down) → evaluate against the weight actually used; don't count as a miss.
6. **Bodyweight exercises** (`load_type = bodyweight`): progress reps only. At `rep_max` on all sets → suggest harder variation (if linked) or, for `bodyweight_plus`, start adding load.
7. **Per-hand loads** (`per_hand`): weight and cap are per dumbbell; volume math multiplies by 2.

### Manual override
- Any set's weight/reps can be edited before or during the session (marks `overridden=1`).
- **Pin** (per routine item): freezes the current target; engine records history but doesn't change suggestions until unpinned.
- **Set next target** from the exercise sheet: writes `progression_state` directly.
- **Undo** on the finish summary reverts this session's progression changes.

### Test cases to write first
Success under cap; success hitting cap with/without variation; partial reps; 3 misses → deload; override down; pinned; per-hand cap; bodyweight; increment rounding (e.g. 2.5 vs 5 lb); unit conversion round-trip (50 lb ↔ kg ↔ 50 lb).

---

## 6. Other engine math

- **e1RM** (Epley): `w × (1 + reps/30)`; only computed for sets with reps ≤ 12. Single-rep sets: e1RM = weight.
- **PRs** detected on set completion (live badge) and rebuilt after edits: max weight, best e1RM, most reps at a given weight, best session volume per exercise.
- **Volume** per muscle per ISO week: working sets × 1.0 for primary muscle, × 0.5 for each secondary. Tonnage = Σ weight × reps (× 2 for per_hand).
- **Calories** (labelled "est."):
  - `kcal = corrected_MET × weight_kg × active_hours`
  - MET by `calorie_intensity`: light 3.5, moderate 5.0, vigorous 6.0 (Compendium of Physical Activities, resistance training).
  - Corrected MET uses the user's resting metabolic rate so height/age/sex matter: RMR (Mifflin-St Jeor, kcal/day) → `RMR_ml = RMR / 1440 / 5 × 1000 / weight_kg`; `corrected_MET = MET × 3.5 / RMR_ml`.
  - If profile is incomplete, fall back to uncorrected MET and show a hint to complete the profile.
  - `active_hours` = workout duration minus any pauses > 10 min (auto-pause idle detection).

---

## 7. Screens & navigation

**Bottom tab bar (5):** Today · Routines · Progress · Body · Settings. The active workout is a full-screen route with a persistent "Resume workout" pill on all tabs while one is active.

### Today
- Header: date, week strip (dots for trained days).
- **Next up** card: suggested routine (rotates through routines in order after the last completed one), exercise count, est. duration. Big red **Start**. Also "Start empty workout".
- Week stats row: sessions this week, total working sets, tonnage.
- Quick-log row: bodyweight (keypad sheet), calories/protein for today.
- Recent PRs (last 7 days).

### Live workout
- Sticky header: routine name, elapsed timer, **Finish**.
- Exercise cards in order; supersets rendered as a grouped block with a red left rail and A1/A2 labels.
- Each card: name, target summary ("3 × 8–12 · 45 lb · cap 50"), status badge (Progressing / Holding / Capped / Deload), overflow menu (swap, notes, history, edit targets, pin).
- **Set row:** `SET | PREVIOUS | LB | REPS | ✓`. Weight/reps pre-filled with suggestions (dimmed until touched). Tapping a value opens the keypad sheet with ± increment steppers. Tapping ✓ completes the set → PR check → rest timer starts.
- Warm-up sets labelled "W", muted styling, toggle "Add warm-ups" generates 50%×8, 70%×5, 85%×2 of the first working weight (rounded to increment).
- Supersets: rest timer starts only after the last exercise in the group; focus auto-advances A1 → A2 → A1.
- **Rest timer:** bottom sheet overlay, large countdown, −15 / +15 / Skip. Collapses to a mini bar so you can keep scrolling.
- Add exercise / reorder / remove mid-session.
- **Finish summary:** duration, working sets, tonnage, est. kcal, PRs earned, and a **"Next time"** list showing each progression change with its reason. Variation-swap and deload prompts appear here. Option to update the routine with any exercises added mid-session.

### Routines
- Segmented control: **Routines | Exercises**.
- Routine list with drag reorder; tap → editor.
- **Routine editor:** add exercises (picker with search + muscle/equipment filters), drag reorder, select 2+ items → "Group as superset", per item: sets, rep range, warm-ups, rest, increment, cap override, progression mode, notes. Duplicate / archive routine.
- **Exercise library:** search, filters, create/edit. Exercise form: name, primary + secondary muscles, equipment, load type, default increment, **max load (equipment cap)**, harder/easier variation pickers, default rest, notes.
- **Exercise detail:** e1RM chart, PR list, full history by session, current targets in each routine.

### Progress
Segmented: **Strength | Volume | Consistency**
- **Strength:** lift selector (favorites pinned), e1RM line over time (range 1M/3M/6M/1Y/All), top-set table, PR timeline. "Capped" lifts flagged.
- **Volume:** weekly sets per muscle as horizontal bars with a shaded 10–20 set band; week-over-week tonnage trend; muscle heat-strip for the last 4 weeks.
- **Consistency:** calendar heatmap (last 12 months), current/best streak (weeks with ≥ N sessions, N configurable), sessions/week bars, average session duration.

### Body
- Bodyweight chart with raw points + 7-day moving average line, range selector, change over period.
- Nutrition: today's calories/protein vs targets (rings), last 30 days bars.
- Log list with edit/delete.

### Settings
- Profile: sex, birth date, height, (weight comes from Body).
- Units (lb/kg), default rest, calorie intensity, targets (calories, protein, weekly sessions).
- Default increments by equipment type.
- Data: export JSON, import JSON (replace or merge), storage persisted status + usage, "Rebuild PRs", reset app (typed confirmation).
- About/version.

---

## 8. Seed exercise library (`src/db/seed/exercises.json`)

~80 entries, `is_seeded=1`, editable. Coverage: barbell compounds (squat, bench, deadlift, OHP, row variants), dumbbell staples, cable and machine isolation, bodyweight (push-up, pull-up, dip, plank variants), kettlebell basics. Each has muscles, equipment, load_type, default increment (barbell 5 lb, dumbbell 5 lb per hand, cable/machine 10 lb, kettlebell 9 lb ≈ 4 kg).

**Pre-link variation chains** so the "harder variation" feature works out of the box, e.g.:
- Push-up → Decline Push-up → Deficit Push-up → Archer Push-up
- DB Bench Press → Single-Arm DB Bench → Deficit (pause) DB Press
- Goblet Squat → DB Bulgarian Split Squat → Pause BSS
- DB RDL → Single-Leg DB RDL
- DB Shoulder Press → Single-Arm DB Press → Seated Z-Press (DB)
- Inverted Row → Feet-Elevated Inverted Row → Pull-up
- Bodyweight Squat → Split Squat → Pistol (assisted) → Pistol

No max load is seeded; the user sets caps in onboarding or per exercise.

**First-run onboarding (3 screens):** units → profile (optional) → "What's your heaviest dumbbell / kettlebell / band?" which bulk-applies max caps to all seeded exercises of that equipment type. Skippable.

---

## 9. Data portability

- **Export:** full DB as versioned JSON (`{schemaVersion, exportedAt, tables:{…}}`) via the iOS share sheet (`navigator.share` with a File) → save to Files/iCloud Drive. Also CSV export of sets for spreadsheets.
- **Import:** validate schema version, preview counts, replace or merge by ULID + `updated_at` (last-write-wins).
- The Supabase mirror (§10) doubles as an off-device backup: "Restore from cloud" in Settings rebuilds local SQLite from the mirror.

---

## 10. Cloud layer + AI connector

Mirrors the Bridger proposal tool architecture: **Cloudflare Worker (API + remote MCP server) + Supabase Postgres**, free tiers only. Reuse auth/MCP patterns from `github.com/johnkakuk/proposal-tool` where possible.

```
iPhone PWA (SQLite, source of truth)
   │  push changes (outbox)        ▲  pull AI drafts (inbox)
   ▼                               │
Cloudflare Worker  ──  /api/*  (PWA, bearer device token)
                   ──  /mcp    (Claude / ChatGPT connector, OAuth)
   │
Supabase Postgres (private, RLS on, service role only from Worker)
```

### Principles
- The app works fully offline; the cloud is additive. If the Worker is down, nothing in the gym breaks.
- **AI never writes directly into your training data.** It writes *drafts* to an inbox; the app shows them for review (accept / edit then accept / reject).
- **Never deletes.** No delete tools exposed via MCP. Updates to existing routines arrive as drafts too.
- Supabase is never called from the browser. Only the Worker holds the service key.

### Mirror (phone → cloud)
- Every local write appends to a local `outbox` table (`table, row_id, op, payload, queued_at`).
- When online (app open, `visibilitychange`, after finishing a workout), the app POSTs batches to `/api/sync/push`. Worker upserts by ULID with last-write-wins on `updated_at`.
- Postgres tables mirror §4 one-to-one (same column names, `jsonb` for JSON columns) plus `user_id` for future-proofing.
- Settings shows "Last synced 2 min ago" + pending count. Sync is optional: toggle off = pure local app.

### Inbox (AI → phone)
```sql
ai_drafts
  id, kind TEXT          -- routine | exercise | routine_update | program
  payload jsonb          -- validated draft (schema below)
  source TEXT            -- claude | chatgpt
  summary TEXT           -- AI's one-line rationale
  status TEXT            -- pending | accepted | rejected
  created_at, resolved_at
```
- App calls `/api/inbox` on open/foreground; pending drafts show as a red dot on Routines + an "AI drafts" card on Today.
- **Review screen:** draft rendered like the routine editor, with diff highlighting for `routine_update`. Unknown exercises are flagged "New exercise will be created" with editable muscles/equipment. Accept writes to local SQLite (new ULIDs), then marks the draft accepted.
- Any starting weight above an exercise's cap is clamped and flagged before accept.

### Draft schema (validated with Zod in the Worker; same schema used in the app)
```ts
RoutineDraft = {
  name: string; notes?: string;
  items: Array<{
    exercise: { id?: string; name: string; primary_muscle?: Muscle; secondary_muscles?: Muscle[];
                equipment?: Equipment; load_type?: LoadType };   // id if matched, else new
    working_sets: number; rep_min: number; rep_max: number;
    warmup_sets?: number; rest_sec?: number; group?: string;     // same group label = superset
    start_weight?: number; unit?: 'lb'|'kg'; notes?: string;
  }>;
}
ProgramDraft = { name: string; weeks?: number; routines: RoutineDraft[]; schedule_note?: string }
```

### MCP tools
Read (so the AI builds informed workouts):
| Tool | Returns |
|---|---|
| `get_training_context` | Units, profile basics, equipment caps by exercise, weekly session target, last 4 weeks of sets per muscle, current progression statuses (incl. capped lifts), recent PRs |
| `list_exercises` | Library with ids, muscles, equipment, caps, variation links (filterable) |
| `list_routines` / `get_routine` | Current routines with full item config |
| `get_exercise_history` | Last N sessions for an exercise: top sets, e1RM trend |
| `get_recent_workouts` | Summaries for a date range |
| `get_body_metrics` | Bodyweight trend + nutrition averages |

Write (drafts only):
| Tool | Effect |
|---|---|
| `propose_routine` | Creates a `routine` draft |
| `propose_program` | Multiple routines as one draft (e.g. a 4-day split) |
| `propose_routine_update` | Draft of changes to an existing routine (by id) |
| `propose_exercise` | New exercise for the library, incl. variation links |
| `list_drafts` | Status of drafts it has sent |

Tool descriptions must tell the model: match existing exercise ids before inventing new ones; respect `max_load` caps; use the user's units; prefer exercises that have a harder variation path when equipment is capped.

### Auth
- **MCP:** OAuth flow compatible with Claude custom connectors and ChatGPT connectors (copy the proposal tool's implementation). Single allowed user.
- **PWA ↔ Worker:** one-time pairing in Settings (enter a code shown in a Worker-protected admin page, or sign in once with Supabase magic link) → long-lived device token stored in IndexedDB; revocable.
- Rate-limit write tools; cap draft payload size.

### Hosting
- Worker at e.g. `redline-api.<domain>`; PWA on Cloudflare Pages. Same-origin routes (`/api`) avoid CORS if both live on one Pages project with a Worker route.
- Note: the PWA must be served over HTTPS from a stable origin; changing origin later strands local data (export/import covers it).

---

## 11. Build phases (for Claude Code)

Each phase ends with passing tests and a manual check on an iPhone (installed to home screen).

1. **Foundation** — Vite/React/TS scaffold, `tokens.css`, base UI components (Button, Card, Sheet, Keypad, Stepper, TabBar, SegmentedControl, Badge), PWA manifest + service worker, sqlite-wasm worker with `opfs-sahpool`, migration runner, repo layer, `storage.persist()`. Verify DB survives app close/reopen on iOS.
2. **Exercises** — seed import, library list/search/filter, create/edit/archive, variation linking, max load + increment fields, onboarding equipment caps.
3. **Routines** — list, editor, superset grouping, per-item config, drag reorder.
4. **Live workout** — start from routine/empty, set logging with keypad, warm-ups, supersets flow, timestamp rest timer, wake lock, crash-safe persistence, resume pill, finish/discard.
5. **Progression engine** — pure engine + full unit tests, wire into prefill + finish summary, override/pin/set-target/undo, cap → variation swap flow, deload prompt.
6. **Body & settings** — bodyweight log + chart, nutrition day log, profile, calorie estimator + tests, unit toggle.
7. **Analytics** — PR materialization + live PR badges, e1RM charts, volume by muscle, consistency heatmap/streaks, exercise detail.
8. **Data & polish** — JSON/CSV export, import with merge, backup-age indicator in Settings, empty states, performance pass (target: cold start < 1.5 s, set completion < 50 ms perceived), Playwright WebKit smoke tests.
9. **Cloud mirror** — Supabase schema + RLS, Cloudflare Worker `/api/sync/push`, local outbox, device pairing, sync status UI, restore-from-cloud.
10. **AI connector** — `ai_drafts` table, MCP server on the Worker with read + propose tools, OAuth, inbox pull + review/accept screen in the app, cap clamping. Test end-to-end from Claude ("build me a 3-day DB-only upper/lower split") and ChatGPT.

> Phases 1–8 ship a complete offline app. 9–10 can start in parallel after phase 3 if desired, since the schema is already sync-ready.

### Definition of done (v1)
- Fully usable in airplane mode after install.
- A full workout (6 exercises, 20 sets, 1 superset) can be logged one-handed without opening the system keyboard.
- No suggestion ever exceeds an exercise's cap.
- Export → delete app → reinstall → import restores everything.
- A routine requested in Claude shows up in the app's inbox within one foreground, and accepting it never changes existing history.
