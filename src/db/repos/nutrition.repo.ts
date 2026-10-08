// Nutrition: a log of entries per day, plus saved meals. Daily totals are the sum of the day's entries.
import type { FoodEntry, Meal, NutritionDay } from '../../shared/types';
import type { Db } from '../sqlite';
import { newId, now } from './common';

const round1 = (n: number) => Math.round(n * 10) / 10;

// ── Saved meals ──

/** Saved meals, most used recently first (then by name). */
export function listMeals(db: Db): Meal[] {
  return db.all<Meal>(
    `SELECT m.id, m.name, m.calories, m.protein_g,
       (SELECT max(f.logged_at) FROM food_log f WHERE f.meal_id = m.id AND f.deleted_at IS NULL) AS last_used_at,
       (SELECT count(*) FROM food_log f WHERE f.meal_id = m.id AND f.deleted_at IS NULL) AS uses
     FROM meals m WHERE m.deleted_at IS NULL
     ORDER BY last_used_at IS NULL, last_used_at DESC, m.name COLLATE NOCASE`,
  );
}

export function saveMeal(db: Db, m: { id?: string; name: string; calories: number | null; protein_g: number | null }): string {
  const name = m.name.trim();
  if (!name) throw new Error('Give the meal a name');
  if (m.calories == null && m.protein_g == null) throw new Error('Enter calories or protein');
  const id = m.id ?? newId();
  if (m.id) db.run('UPDATE meals SET name = ?, calories = ?, protein_g = ? WHERE id = ?', [name, m.calories, m.protein_g, id]);
  else db.run('INSERT INTO meals (id, name, calories, protein_g) VALUES (?,?,?,?)', [id, name, m.calories, m.protein_g]);
  return id;
}

/** Remove a saved meal. Past log entries keep their name and numbers. */
export function deleteMeal(db: Db, id: string) {
  db.run('UPDATE meals SET deleted_at = ? WHERE id = ?', [now(), id]);
}

// ── Food log ──

export interface LogFoodInput {
  date: string;
  /** Log a saved meal (its numbers × servings)… */
  meal_id?: string | null;
  servings?: number;
  /** …or enter numbers directly. */
  name?: string | null;
  calories?: number | null;
  protein_g?: number | null;
}

export function logFood(db: Db, input: LogFoodInput): string {
  const servings = input.servings && input.servings > 0 ? input.servings : 1;
  let name = input.name?.trim() || null;
  let calories = input.calories ?? null;
  let protein = input.protein_g ?? null;
  if (input.meal_id) {
    const m = db.get<{ name: string; calories: number | null; protein_g: number | null }>('SELECT name, calories, protein_g FROM meals WHERE id = ?', [input.meal_id]);
    if (!m) throw new Error('Meal not found');
    name = m.name;
    calories = m.calories == null ? null : Math.round(m.calories * servings);
    protein = m.protein_g == null ? null : round1(m.protein_g * servings);
  }
  if (calories == null && protein == null) throw new Error('Enter calories or protein');
  const id = newId();
  db.run(
    'INSERT INTO food_log (id, date, logged_at, meal_id, name, servings, calories, protein_g) VALUES (?,?,?,?,?,?,?,?)',
    [id, input.date, now(), input.meal_id ?? null, name, servings, calories, protein],
  );
  return id;
}

export function updateFood(db: Db, id: string, patch: { name?: string | null; calories?: number | null; protein_g?: number | null }) {
  const cur = db.get<FoodEntry>('SELECT * FROM food_log WHERE id = ?', [id]);
  if (!cur) throw new Error('Entry not found');
  const calories = patch.calories !== undefined ? patch.calories : cur.calories;
  const protein = patch.protein_g !== undefined ? patch.protein_g : cur.protein_g;
  if (calories == null && protein == null) throw new Error('Enter calories or protein');
  db.run('UPDATE food_log SET name = ?, calories = ?, protein_g = ? WHERE id = ?', [
    patch.name !== undefined ? patch.name?.trim() || null : cur.name, calories, protein, id,
  ]);
}

export function deleteFood(db: Db, id: string) {
  db.run('UPDATE food_log SET deleted_at = ? WHERE id = ?', [now(), id]);
}

export function listFood(db: Db, date: string): FoodEntry[] {
  return db.all<FoodEntry>(
    `SELECT id, date, logged_at, meal_id, name, servings, calories, protein_g FROM food_log
     WHERE date = ? AND deleted_at IS NULL ORDER BY logged_at`, [date],
  );
}

// ── Totals ──

/** A day's totals, or null when nothing was logged. */
export function getNutrition(db: Db, date: string): NutritionDay | null {
  const r = db.get<{ calories: number | null; protein_g: number | null; entries: number }>(
    `SELECT sum(calories) AS calories, sum(protein_g) AS protein_g, count(*) AS entries
     FROM food_log WHERE date = ? AND deleted_at IS NULL`, [date],
  );
  if (!r || r.entries === 0) return null;
  return { date, calories: r.calories, protein_g: r.protein_g == null ? null : round1(r.protein_g), entries: r.entries };
}

/** Daily totals for every day with entries since a date, oldest first. */
export function listNutrition(db: Db, sinceDate?: string): NutritionDay[] {
  return db.all<NutritionDay>(
    `SELECT date, sum(calories) AS calories, round(sum(protein_g), 1) AS protein_g, count(*) AS entries
     FROM food_log WHERE deleted_at IS NULL ${sinceDate ? 'AND date >= ?' : ''}
     GROUP BY date ORDER BY date`,
    sinceDate ? [sinceDate] : [],
  );
}
