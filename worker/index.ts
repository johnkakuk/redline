// Redline Worker: serves the PWA (static assets) and the /api used for cloud sync.
// Only this Worker holds the Supabase secret key. The browser talks to Supabase Auth only (to log in).
import {
  JSON_COLUMNS, SYNC_BATCH, SYNCED_TABLES,
  type PullResponse, type PushResponse, type SyncedTable, type SyncRow,
} from '../src/shared/sync';

export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
}

const MAX_BODY = 4 * 1024 * 1024;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// ── Supabase (PostgREST) ──

async function sb(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_SECRET_KEY, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    console.error('supabase', res.status, await res.text());
    throw new HttpError(502, 'Cloud database error');
  }
  return res;
}

// ── Auth: Supabase Auth access tokens (from /login in the app) ──

interface AuthUser { id: string; email: string }
const userCache = new Map<string, { user: AuthUser; until: number }>();

/** Resolve the signed-in user from the bearer token. Cached briefly per isolate. */
async function userFor(req: Request, env: Env): Promise<AuthUser> {
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Log in to sync');
  const hit = userCache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${token}` } });
  if (!res.ok) throw new HttpError(401, 'Session expired. Log in again.');
  const u = (await res.json()) as { id: string; email: string };
  const user = { id: u.id, email: u.email };
  if (userCache.size > 500) userCache.clear();
  userCache.set(token, { user, until: Date.now() + 5 * 60 * 1000 });
  return user;
}

async function readJson<T>(req: Request): Promise<T> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, 'Payload too large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Payload too large');
  try { return JSON.parse(text) as T; } catch { throw new HttpError(400, 'Invalid JSON'); }
}

const isTable = (t: unknown): t is SyncedTable => typeof t === 'string' && (SYNCED_TABLES as readonly string[]).includes(t);

// ── Routes ──

/** Phone JSON-text columns → jsonb values. */
function toCloud(table: SyncedTable, row: SyncRow): SyncRow {
  const cols = JSON_COLUMNS[table];
  if (!cols) return row;
  const out: SyncRow = { ...row };
  for (const c of cols) {
    const v = out[c];
    if (typeof v === 'string') {
      try { out[c] = JSON.parse(v); } catch { out[c] = v; }
    }
  }
  return out;
}

/** jsonb values → JSON text, as the phone stores them. */
function toPhone(table: SyncedTable, row: Record<string, unknown>): SyncRow {
  const { user_id: _u, ...rest } = row;
  for (const c of JSON_COLUMNS[table] ?? []) {
    if (rest[c] != null && typeof rest[c] !== 'string') rest[c] = JSON.stringify(rest[c]);
  }
  return rest as SyncRow;
}

async function push(req: Request, env: Env, user: AuthUser): Promise<Response> {
  const body = await readJson<{ table?: unknown; rows?: unknown }>(req);
  if (!isTable(body.table)) throw new HttpError(400, 'Unknown table');
  if (!Array.isArray(body.rows) || body.rows.length > SYNC_BATCH) throw new HttpError(400, `rows must be an array of at most ${SYNC_BATCH}`);
  const rows = (body.rows as SyncRow[]).filter((r) => r && typeof r.id === 'string' && typeof r.updated_at === 'string');
  if (rows.length !== body.rows.length) throw new HttpError(400, 'Every row needs id and updated_at');
  if (!rows.length) return json({ written: 0 } satisfies PushResponse);
  const res = await sb(env, 'rpc/sync_push', {
    method: 'POST',
    body: JSON.stringify({ p_user: user.id, p_table: body.table, p_rows: rows.map((r) => toCloud(body.table as SyncedTable, r)) }),
  });
  return json({ written: (await res.json()) as number } satisfies PushResponse);
}

async function pull(url: URL, env: Env, user: AuthUser): Promise<Response> {
  const table = url.searchParams.get('table');
  if (!isTable(table)) throw new HttpError(400, 'Unknown table');
  const after = url.searchParams.get('after') ?? '';
  const q = new URLSearchParams({ select: '*', user_id: `eq.${user.id}`, order: 'id.asc', limit: String(SYNC_BATCH) });
  if (after) q.set('id', `gt.${after}`);
  const rows = ((await (await sb(env, `${table}?${q}`)).json()) as Record<string, unknown>[]).map((r) => toPhone(table, r));
  return json({ rows, next: rows.length === SYNC_BATCH ? rows[rows.length - 1].id : null } satisfies PullResponse);
}

async function api(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const route = `${req.method} ${url.pathname}`;
  switch (route) {
    case 'GET /api/health':
      return json({ ok: true });
    case 'GET /api/me':
      return json(await userFor(req, env));
    case 'POST /api/sync/push':
      return push(req, env, await userFor(req, env));
    case 'GET /api/sync/pull':
      return pull(url, env, await userFor(req, env));
    default:
      throw new HttpError(404, 'Not found');
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await api(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Server error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
