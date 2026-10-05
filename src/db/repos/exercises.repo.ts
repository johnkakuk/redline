import type { Equipment, Exercise, ExerciseInput, Muscle } from '../../shared/types';
import seed from '../seed/exercises.json';
import type { Bind, Db } from '../sqlite';
import { getExerciseRow, newId, toExercise } from './common';
import { getSettings } from './settings.repo';

export interface ExerciseFilter {
  search?: string;
  muscle?: Muscle | null;
  equipment?: Equipment | null;
  /** Only exercises using one of these equipment types. */
  equipmentIn?: Equipment[] | null;
  /** Exercises working any of these muscles (primary or secondary). */
  musclesIn?: Muscle[] | null;
  sort?: 'az' | 'za';
  includeArchived?: boolean;
}

export function listExercises(db: Db, f: ExerciseFilter = {}): Exercise[] {
  const where = ['deleted_at IS NULL'];
  const params: Bind = [];
  if (!f.includeArchived) where.push('archived = 0');
  if (f.equipment) { where.push('equipment = ?'); params.push(f.equipment); }
  if (f.equipmentIn) {
    where.push(`equipment IN (${f.equipmentIn.map(() => '?').join(', ') || "''"})`);
    params.push(...f.equipmentIn);
  }
  if (f.muscle) {
    where.push(`(primary_muscle = ? OR EXISTS (SELECT 1 FROM json_each(secondary_muscles) WHERE value = ?))`);
    params.push(f.muscle, f.muscle);
  }
  if (f.musclesIn?.length) {
    const qs = f.musclesIn.map(() => '?').join(', ');
    where.push(`(primary_muscle IN (${qs}) OR EXISTS (SELECT 1 FROM json_each(secondary_muscles) WHERE value IN (${qs})))`);
    params.push(...f.musclesIn, ...f.musclesIn);
  }
  if (f.search?.trim()) {
    for (const term of f.search.trim().toLowerCase().split(/\s+/)) {
      where.push('lower(name) LIKE ?');
      params.push(`%${term}%`);
    }
  }
  return db.all(`SELECT * FROM exercises WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE ${f.sort === 'za' ? 'DESC' : 'ASC'}`, params).map(toExercise);
}

export function getExercise(db: Db, id: string): Exercise {
  return getExerciseRow(db, id);
}

export function findExerciseByName(db: Db, name: string): Exercise | null {
  const r = db.get('SELECT * FROM exercises WHERE lower(name) = lower(?) AND deleted_at IS NULL', [name.trim()]);
  return r ? toExercise(r) : null;
}

export function saveExercise(db: Db, input: ExerciseInput): string {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  return db.tx(() => {
    const id = input.id ?? newId();
    const vals = [
      name, input.primary_muscle, JSON.stringify(input.secondary_muscles ?? []), input.equipment, input.load_type,
      input.default_increment_kg, input.max_load_kg, input.harder_variation_id === id ? null : input.harder_variation_id,
      input.easier_variation_id === id ? null : input.easier_variation_id, input.default_rest_sec, input.notes?.trim() || null,
    ];
    if (input.id) {
      db.run(
        `UPDATE exercises SET name=?, primary_muscle=?, secondary_muscles=?, equipment=?, load_type=?, default_increment_kg=?,
          max_load_kg=?, harder_variation_id=?, easier_variation_id=?, default_rest_sec=?, notes=? WHERE id=?`,
        [...vals, id],
      );
    } else {
      db.run(
        `INSERT INTO exercises (name, primary_muscle, secondary_muscles, equipment, load_type, default_increment_kg,
          max_load_kg, harder_variation_id, easier_variation_id, default_rest_sec, notes, id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [...vals, id],
      );
    }
    // Keep the chain symmetric where the other side is unset.
    if (input.harder_variation_id && input.harder_variation_id !== id) {
      db.run('UPDATE exercises SET easier_variation_id = ? WHERE id = ? AND easier_variation_id IS NULL', [id, input.harder_variation_id]);
    }
    if (input.easier_variation_id && input.easier_variation_id !== id) {
      db.run('UPDATE exercises SET harder_variation_id = ? WHERE id = ? AND harder_variation_id IS NULL', [id, input.easier_variation_id]);
    }
    return id;
  });
}

export function archiveExercise(db: Db, id: string, archived: boolean) {
  db.run('UPDATE exercises SET archived = ? WHERE id = ?', [archived ? 1 : 0, id]);
}

/** Onboarding: "What's your heaviest dumbbell?" → cap every exercise of that equipment type. */
export function applyEquipmentCaps(db: Db, caps: Partial<Record<Equipment, number | null>>) {
  db.tx(() => {
    for (const [eq, kg] of Object.entries(caps)) {
      if (kg === undefined) continue;
      db.run(
        `UPDATE exercises SET max_load_kg = ? WHERE equipment = ? AND load_type != 'bodyweight' AND deleted_at IS NULL`,
        [kg, eq],
      );
    }
  });
}

/** Seeded exercises get the same id on every install, so data from several devices merges cleanly. */
export const seedId = (name: string) => `seed-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/** One-time: move seeded exercises created with random ids onto their deterministic ids. */
export function normalizeSeedIds(db: Db): number {
  const rows = db.all<{ id: string; name: string }>(`SELECT id, name FROM exercises WHERE is_seeded = 1 AND id NOT LIKE 'seed-%'`);
  if (!rows.length) return 0;
  let moved = 0;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.tx(() => {
      for (const r of rows) {
        const nid = seedId(r.name);
        if (db.get('SELECT 1 FROM exercises WHERE id = ?', [nid])) continue;
        db.run('UPDATE exercises SET id = ? WHERE id = ?', [nid, r.id]);
        db.run('UPDATE exercises SET harder_variation_id = ? WHERE harder_variation_id = ?', [nid, r.id]);
        db.run('UPDATE exercises SET easier_variation_id = ? WHERE easier_variation_id = ?', [nid, r.id]);
        for (const t of ['routine_items', 'workout_exercises', 'personal_records']) {
          db.run(`UPDATE ${t} SET exercise_id = ? WHERE exercise_id = ?`, [nid, r.id]);
        }
        moved++;
      }
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return moved;
}

interface SeedRow {
  name: string; equipment: Equipment; load_type: Exercise['load_type']; primary_muscle: Muscle;
  secondary_muscles: Muscle[]; harder: string | null; default_rest_sec: number | null; notes: string | null;
}

/**
 * Built-in "harder" links that earlier versions shipped and later replaced (exercise → old harder).
 * Installs still on the old link get the new one; links the user changed are left alone.
 */
const RETIRED_SEED_LINKS: [string, string][] = [
  ['DB Bench Press', 'Single-Arm DB Bench Press'],
  ['Single-Arm DB Bench Press', 'Deficit Pause DB Press'],
  ['Incline DB Press', 'Single-Arm Incline DB Press'],
  ['DB Shoulder Press', 'Single-Arm DB Shoulder Press'],
  ['Single-Arm DB Shoulder Press', 'Seated DB Z-Press'],
];

function retireOldLinks(db: Db) {
  for (const [from, oldHarder] of RETIRED_SEED_LINKS) {
    const a = seedId(from);
    const b = seedId(oldHarder);
    if (db.run('UPDATE exercises SET harder_variation_id = NULL WHERE id = ? AND harder_variation_id = ?', [a, b])) {
      db.run('UPDATE exercises SET easier_variation_id = NULL WHERE id = ? AND easier_variation_id = ?', [b, a]);
    }
  }
}

/** Insert the seeded library (idempotent by name) and link variation chains. */
export function seedExercises(db: Db): number {
  const s = getSettings(db);
  const rows = seed as SeedRow[];
  let inserted = 0;
  db.tx(() => {
    const ids = new Map<string, string>();
    for (const r of rows) {
      const existing = findExerciseByName(db, r.name);
      if (existing) { ids.set(r.name, existing.id); continue; }
      const id = seedId(r.name);
      ids.set(r.name, id);
      db.run(
        `INSERT INTO exercises (id, name, primary_muscle, secondary_muscles, equipment, load_type, default_increment_kg,
          default_rest_sec, notes, is_seeded) VALUES (?,?,?,?,?,?,?,?,?,1)`,
        [id, r.name, r.primary_muscle, JSON.stringify(r.secondary_muscles), r.equipment, r.load_type,
          s.default_increment[r.equipment], r.default_rest_sec, r.notes],
      );
      inserted++;
    }
    retireOldLinks(db);
    for (const r of rows) {
      if (!r.harder) continue;
      const a = ids.get(r.name)!;
      const b = ids.get(r.harder)!;
      db.run('UPDATE exercises SET harder_variation_id = ? WHERE id = ? AND harder_variation_id IS NULL', [b, a]);
      db.run('UPDATE exercises SET easier_variation_id = ? WHERE id = ? AND easier_variation_id IS NULL', [a, b]);
    }
  });
  return inserted;
}
