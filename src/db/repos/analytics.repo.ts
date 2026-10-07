import { e1rm } from '../../engine/e1rm';
import { computePrEvents, type PrSet } from '../../engine/prs';
import { setsPerMuscle, setTonnage } from '../../engine/volume';
import { addDays, localDate, startOfWeek, weekKey } from '../../shared/time';
import type { Exercise, LoadType, Muscle, PrType, ProgressionState, SetKind } from '../../shared/types';
import type { Db } from '../sqlite';
import { getExerciseRow, newId, toState } from './common';
import { getSettings } from './settings.repo';

interface SetFact {
  set_id: string;
  weight_kg: number | null;
  reps: number | null;
  completed_at: string;
  workout_id: string;
  started_at: string;
  exercise_id: string;
  load_type: LoadType;
  primary_muscle: Muscle;
  secondary_muscles: string;
}

const FACTS = `SELECT s.id AS set_id, s.weight_kg, s.reps, s.completed_at, w.id AS workout_id, w.started_at,
    e.id AS exercise_id, e.load_type, e.primary_muscle, e.secondary_muscles
  FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
  JOIN exercises e ON e.id = we.exercise_id
  WHERE s.kind = 'working' AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL AND we.deleted_at IS NULL
    AND w.deleted_at IS NULL AND w.status = 'completed'`;

function facts(db: Db, where = '', params: (string | number)[] = []): SetFact[] {
  return db.all<SetFact>(`${FACTS} ${where} ORDER BY s.completed_at`, params);
}

// ── PRs ──

/** Rebuild materialized PR events from sets (all exercises when ids is omitted). */
export function rebuildPrs(db: Db, exerciseIds?: string[]) {
  db.tx(() => {
    const ids = exerciseIds ?? db.all<{ id: string }>('SELECT id FROM exercises').map((r) => r.id);
    for (const id of ids) {
      db.run('DELETE FROM personal_records WHERE exercise_id = ?', [id]);
      const sets = facts(db, 'AND e.id = ?', [id]);
      if (!sets.length) continue;
      const loadType = sets[0].load_type;
      const pr: PrSet[] = sets.map((s) => ({ set_id: s.set_id, workout_id: s.workout_id, weight_kg: s.weight_kg, reps: s.reps, completed_at: s.completed_at }));
      for (const ev of computePrEvents(pr, loadType)) {
        db.run(
          `INSERT INTO personal_records (id, exercise_id, type, value, weight_kg, reps, set_id, workout_id, achieved_at, baseline)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [newId(), id, ev.type, ev.value, ev.weight_kg, ev.reps, ev.set_id, ev.workout_id, ev.achieved_at, ev.baseline ? 1 : 0],
        );
      }
    }
  });
}

export interface PrRow {
  exercise_id: string; exercise_name: string; type: PrType; value: number; weight_kg: number | null; reps: number | null;
  achieved_at: string; workout_id: string; load_type: LoadType;
}

export function recentPrs(db: Db, opts: { sinceIso?: string; exerciseId?: string; limit?: number } = {}): PrRow[] {
  const where = ['p.baseline = 0', 'p.deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (opts.sinceIso) { where.push('p.achieved_at >= ?'); params.push(opts.sinceIso); }
  if (opts.exerciseId) { where.push('p.exercise_id = ?'); params.push(opts.exerciseId); }
  // Collapse to the best value per exercise, type and workout.
  return db.all<PrRow>(
    `SELECT p.exercise_id, e.name AS exercise_name, e.load_type, p.type, max(p.value) AS value, p.weight_kg, p.reps,
       p.achieved_at, p.workout_id
     FROM personal_records p JOIN exercises e ON e.id = p.exercise_id
     WHERE ${where.join(' AND ')}
     GROUP BY p.exercise_id, p.type, p.workout_id ORDER BY achieved_at DESC LIMIT ?`,
    [...params, opts.limit ?? 50],
  );
}

// ── Today ──

export function weekStats(db: Db) {
  const thisWeek = startOfWeek();
  const lastWeek = addDays(thisWeek, -7);
  const f = facts(db, 'AND w.started_at >= ?', [lastWeek.toISOString()]);
  const sum = (from: Date, to: Date) => {
    const xs = f.filter((s) => { const t = new Date(s.started_at); return t >= from && t < to; });
    return {
      sessions: new Set(xs.map((s) => s.workout_id)).size,
      sets: xs.length,
      tonnage_kg: xs.reduce((a, s) => a + setTonnage(s.weight_kg, s.reps, s.load_type), 0),
    };
  };
  const trainedDates = db.all<{ started_at: string }>(
    // This week and last week: the Today strip can swipe back one week.
    `SELECT started_at FROM workouts WHERE status = 'completed' AND deleted_at IS NULL AND started_at >= ?`, [lastWeek.toISOString()],
  ).map((r) => localDate(r.started_at));
  return {
    current: sum(thisWeek, addDays(thisWeek, 7)),
    previous: sum(lastWeek, thisWeek),
    trained_dates: [...new Set(trainedDates)],
    weekly_target: getSettings(db).weekly_target,
  };
}

// ── Strength ──

export interface LiftRow {
  id: string; name: string; load_type: LoadType; sessions: number; last_at: string;
  latest_e1rm: number | null; best_e1rm: number | null; best_reps: number | null; capped: boolean;
}

export function strengthLifts(db: Db): LiftRow[] {
  const all = facts(db);
  const by = new Map<string, SetFact[]>();
  for (const s of all) (by.get(s.exercise_id) ?? by.set(s.exercise_id, []).get(s.exercise_id)!).push(s);
  const capped = new Set(
    db.all<{ exercise_id: string }>(
      `SELECT i.exercise_id FROM progression_state p JOIN routine_items i ON i.id = p.routine_item_id JOIN routines r ON r.id = i.routine_id
       WHERE p.status IN ('capped', 'variation_suggested') AND p.deleted_at IS NULL AND i.deleted_at IS NULL AND r.deleted_at IS NULL AND r.archived = 0`,
    ).map((r) => r.exercise_id),
  );
  const out: LiftRow[] = [];
  for (const [id, sets] of by) {
    const ex = getExerciseRow(db, id);
    const sessions = groupSessions(sets);
    const lastSession = sessions.at(-1)!;
    const es = (xs: SetFact[]) => Math.max(0, ...xs.map((s) => (s.weight_kg && s.reps ? e1rm(s.weight_kg, s.reps) ?? 0 : 0)));
    out.push({
      id, name: ex.name, load_type: ex.load_type, sessions: sessions.length, last_at: lastSession.started_at,
      latest_e1rm: es(lastSession.sets) || null, best_e1rm: es(sets) || null,
      best_reps: Math.max(0, ...sets.map((s) => s.reps ?? 0)) || null, capped: capped.has(id),
    });
  }
  return out.sort((a, b) => b.sessions - a.sessions || b.last_at.localeCompare(a.last_at));
}

function groupSessions(sets: SetFact[]) {
  const m = new Map<string, { workout_id: string; started_at: string; sets: SetFact[] }>();
  for (const s of sets) {
    const g = m.get(s.workout_id) ?? { workout_id: s.workout_id, started_at: s.started_at, sets: [] };
    g.sets.push(s);
    m.set(s.workout_id, g);
  }
  return [...m.values()].sort((a, b) => a.started_at.localeCompare(b.started_at));
}

export interface SeriesPoint {
  workout_id: string; date: string; value: number; weight_kg: number | null; reps: number | null; pr: boolean;
}

/** Best e1RM per session (or best reps for bodyweight-only lifts). */
export function strengthSeries(db: Db, exerciseId: string, sinceIso?: string): { metric: 'e1rm' | 'reps'; points: SeriesPoint[] } {
  const ex = getExerciseRow(db, exerciseId);
  const metric = ex.load_type === 'bodyweight' ? 'reps' : 'e1rm';
  const sets = facts(db, `AND e.id = ? ${sinceIso ? 'AND w.started_at >= ?' : ''}`, sinceIso ? [exerciseId, sinceIso] : [exerciseId]);
  const prWorkouts = new Set(
    db.all<{ workout_id: string }>(
      `SELECT workout_id FROM personal_records WHERE exercise_id = ? AND baseline = 0 AND type = ?`,
      [exerciseId, 'session_volume'],
    ).map((r) => r.workout_id),
  );
  const points: SeriesPoint[] = [];
  for (const g of groupSessions(sets)) {
    let best: SeriesPoint | null = null;
    for (const s of g.sets) {
      const v = metric === 'reps' ? s.reps ?? 0 : s.weight_kg && s.reps ? e1rm(s.weight_kg, s.reps) ?? 0 : 0;
      if (v > 0 && (!best || v > best.value)) {
        best = { workout_id: g.workout_id, date: g.started_at, value: v, weight_kg: s.weight_kg, reps: s.reps, pr: prWorkouts.has(g.workout_id) };
      }
    }
    if (best) points.push(best);
  }
  return { metric, points };
}

export interface SessionHistory {
  workout_id: string; date: string; workout_name: string;
  sets: { kind: SetKind; weight_kg: number | null; reps: number | null }[];
  top: { weight_kg: number | null; reps: number | null } | null;
  volume_kg: number;
}

export function exerciseHistory(db: Db, exerciseId: string, limit = 30): SessionHistory[] {
  const rows = db.all<{ workout_id: string; started_at: string; name: string; kind: SetKind; weight_kg: number | null; reps: number | null; load_type: LoadType }>(
    `SELECT w.id AS workout_id, w.started_at, w.name, s.kind, s.weight_kg, s.reps, e.load_type
     FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
     JOIN exercises e ON e.id = we.exercise_id
     WHERE we.exercise_id = ? AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL AND we.deleted_at IS NULL
       AND w.deleted_at IS NULL AND w.status = 'completed'
     ORDER BY w.started_at DESC, CASE s.kind WHEN 'warmup' THEN 0 ELSE 1 END, s.sort_order`, [exerciseId],
  );
  const out: SessionHistory[] = [];
  for (const r of rows) {
    let h = out.at(-1);
    if (!h || h.workout_id !== r.workout_id) {
      if (out.length >= limit) break;
      h = { workout_id: r.workout_id, date: r.started_at, workout_name: r.name, sets: [], top: null, volume_kg: 0 };
      out.push(h);
    }
    h.sets.push({ kind: r.kind, weight_kg: r.weight_kg, reps: r.reps });
    if (r.kind === 'working') {
      h.volume_kg += setTonnage(r.weight_kg, r.reps, r.load_type);
      if (!h.top || (r.weight_kg ?? 0) > (h.top.weight_kg ?? 0) || ((r.weight_kg ?? 0) === (h.top.weight_kg ?? 0) && (r.reps ?? 0) > (h.top.reps ?? 0))) {
        h.top = { weight_kg: r.weight_kg, reps: r.reps };
      }
    }
  }
  return out;
}

export interface ExerciseDetail {
  exercise: Exercise;
  harder: { id: string; name: string } | null;
  easier: { id: string; name: string } | null;
  bests: Partial<Record<PrType, { value: number; weight_kg: number | null; reps: number | null; achieved_at: string }>>;
  routines: { routine_id: string; routine_name: string; item_id: string; working_sets: number; rep_min: number; rep_max: number; state: ProgressionState | null }[];
}

export function exerciseDetail(db: Db, id: string): ExerciseDetail {
  const exercise = getExerciseRow(db, id);
  const link = (x: string | null) => (x ? db.get<{ id: string; name: string }>('SELECT id, name FROM exercises WHERE id = ?', [x]) ?? null : null);
  const bests: ExerciseDetail['bests'] = {};
  for (const r of db.all<{ type: PrType; value: number; weight_kg: number | null; reps: number | null; achieved_at: string }>(
    `SELECT type, value, weight_kg, reps, achieved_at FROM personal_records WHERE exercise_id = ? AND type != 'reps_at_weight' ORDER BY value`, [id],
  )) bests[r.type] = r;
  const routines = db.all<{ routine_id: string; routine_name: string; item_id: string; working_sets: number; rep_min: number; rep_max: number }>(
    `SELECT r.id AS routine_id, r.name AS routine_name, i.id AS item_id, i.working_sets, i.rep_min, i.rep_max
     FROM routine_items i JOIN routines r ON r.id = i.routine_id
     WHERE i.exercise_id = ? AND i.deleted_at IS NULL AND r.deleted_at IS NULL AND r.archived = 0 ORDER BY r.sort_order`, [id],
  ).map((r) => {
    const st = db.get('SELECT * FROM progression_state WHERE routine_item_id = ? AND deleted_at IS NULL', [r.item_id]);
    return { ...r, state: st ? toState(st) : null };
  });
  return { exercise, harder: link(exercise.harder_variation_id), easier: link(exercise.easier_variation_id), bests, routines };
}

// ── Volume ──

export function volumeByMuscle(db: Db, weekStart: string): { muscle: Muscle; sets: number }[] {
  const from = new Date(weekStart + 'T00:00:00');
  const to = addDays(from, 7);
  const f = facts(db, 'AND w.started_at >= ? AND w.started_at < ?', [from.toISOString(), to.toISOString()]);
  const m = setsPerMuscle(f.map((s) => ({ primary: s.primary_muscle, secondary: JSON.parse(s.secondary_muscles), sets: 1 })));
  return (Object.entries(m) as [Muscle, number][]).map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets);
}

/** Weekly tonnage + sets, oldest first, ending with the current week. */
export function weeklyTrend(db: Db, weeks = 12) {
  const start = addDays(startOfWeek(), -7 * (weeks - 1));
  const f = facts(db, 'AND w.started_at >= ?', [start.toISOString()]);
  const out = Array.from({ length: weeks }, (_, i) => ({ week: localDate(addDays(start, 7 * i)), tonnage_kg: 0, sets: 0, sessions: new Set<string>() }));
  const idx = new Map(out.map((o, i) => [o.week, i]));
  for (const s of f) {
    const o = out[idx.get(weekKey(s.started_at)) ?? -1];
    if (!o) continue;
    o.tonnage_kg += setTonnage(s.weight_kg, s.reps, s.load_type);
    o.sets++;
    o.sessions.add(s.workout_id);
  }
  return out.map(({ sessions, ...o }) => ({ ...o, sessions: sessions.size }));
}

/** Sets per muscle for each of the last N weeks (oldest first). */
export function muscleWeeks(db: Db, weeks = 4): { weeks: string[]; rows: { muscle: Muscle; values: number[] }[] } {
  const start = addDays(startOfWeek(), -7 * (weeks - 1));
  const keys = Array.from({ length: weeks }, (_, i) => localDate(addDays(start, 7 * i)));
  const f = facts(db, 'AND w.started_at >= ?', [start.toISOString()]);
  const per = keys.map((k) =>
    setsPerMuscle(f.filter((s) => weekKey(s.started_at) === k).map((s) => ({ primary: s.primary_muscle, secondary: JSON.parse(s.secondary_muscles), sets: 1 }))),
  );
  const muscles = new Set<Muscle>();
  per.forEach((p) => (Object.keys(p) as Muscle[]).forEach((m) => muscles.add(m)));
  const rows = [...muscles].map((muscle) => ({ muscle, values: per.map((p) => p[muscle] ?? 0) }));
  rows.sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0));
  return { weeks: keys, rows };
}

// ── Consistency ──

export function consistency(db: Db) {
  const target = getSettings(db).weekly_target;
  const ws = db.all<{ started_at: string; active_duration_sec: number | null }>(
    `SELECT started_at, active_duration_sec FROM workouts WHERE status = 'completed' AND deleted_at IS NULL ORDER BY started_at`,
  );
  const days: Record<string, number> = {};
  const perWeek = new Map<string, number>();
  for (const w of ws) {
    const d = localDate(w.started_at);
    days[d] = (days[d] ?? 0) + 1;
    const k = weekKey(w.started_at);
    perWeek.set(k, (perWeek.get(k) ?? 0) + 1);
  }
  // Streaks of consecutive weeks meeting the target. The current week counts once met, but doesn't break the streak while in progress.
  const thisWeek = localDate(startOfWeek());
  let current = 0;
  let cursor = startOfWeek();
  if ((perWeek.get(thisWeek) ?? 0) >= target) current++;
  cursor = addDays(cursor, -7);
  while ((perWeek.get(localDate(cursor)) ?? 0) >= target) { current++; cursor = addDays(cursor, -7); }
  let best = 0;
  if (ws.length) {
    let run = 0;
    for (let c = startOfWeek(new Date(ws[0].started_at)); c <= startOfWeek(); c = addDays(c, 7)) {
      run = (perWeek.get(localDate(c)) ?? 0) >= target ? run + 1 : 0;
      best = Math.max(best, run);
    }
  }
  const recent = ws.filter((w) => w.active_duration_sec && Date.parse(w.started_at) > Date.now() - 90 * 86400000);
  return {
    days,
    weekly_target: target,
    current_streak: current,
    best_streak: Math.max(best, current),
    total_sessions: ws.length,
    avg_duration_sec: recent.length ? recent.reduce((a, w) => a + (w.active_duration_sec ?? 0), 0) / recent.length : null,
  };
}
