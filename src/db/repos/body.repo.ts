import type { BodyWeightEntry, NutritionDay } from '../../shared/types';
import type { Db } from '../sqlite';
import { newId, now } from './common';

export function latestBodyweightKg(db: Db): number | null {
  return db.get<{ weight_kg: number }>(
    'SELECT weight_kg FROM body_weight WHERE deleted_at IS NULL ORDER BY date DESC, created_at DESC LIMIT 1',
  )?.weight_kg ?? null;
}

export function logBodyweight(db: Db, e: { date: string; weight_kg: number; note?: string | null }): string {
  if (!(e.weight_kg > 0)) throw new Error('Enter a weight');
  const id = newId();
  db.run('INSERT INTO body_weight (id, date, weight_kg, note) VALUES (?,?,?,?)', [id, e.date, e.weight_kg, e.note?.trim() || null]);
  return id;
}

export function updateBodyweight(db: Db, id: string, e: { date: string; weight_kg: number; note?: string | null }) {
  db.run('UPDATE body_weight SET date = ?, weight_kg = ?, note = ? WHERE id = ?', [e.date, e.weight_kg, e.note?.trim() || null, id]);
}

export function deleteBodyweight(db: Db, id: string) {
  db.run('UPDATE body_weight SET deleted_at = ? WHERE id = ?', [now(), id]);
}

export function listBodyweight(db: Db, sinceDate?: string): BodyWeightEntry[] {
  return db.all<BodyWeightEntry>(
    `SELECT id, date, weight_kg, note, created_at FROM body_weight WHERE deleted_at IS NULL ${sinceDate ? 'AND date >= ?' : ''}
     ORDER BY date, created_at`,
    sinceDate ? [sinceDate] : [],
  );
}

export function getNutrition(db: Db, date: string): NutritionDay | null {
  return db.get<NutritionDay>('SELECT id, date, calories, protein_g FROM nutrition_day WHERE date = ? AND deleted_at IS NULL', [date]) ?? null;
}

export function upsertNutrition(db: Db, date: string, v: { calories?: number | null; protein_g?: number | null }) {
  const existing = db.get<{ id: string; calories: number | null; protein_g: number | null }>('SELECT id, calories, protein_g FROM nutrition_day WHERE date = ?', [date]);
  const calories = v.calories !== undefined ? v.calories : existing?.calories ?? null;
  const protein = v.protein_g !== undefined ? v.protein_g : existing?.protein_g ?? null;
  if (existing) {
    db.run('UPDATE nutrition_day SET calories = ?, protein_g = ?, deleted_at = NULL WHERE id = ?', [calories, protein, existing.id]);
  } else {
    db.run('INSERT INTO nutrition_day (id, date, calories, protein_g) VALUES (?,?,?,?)', [newId(), date, calories, protein]);
  }
}

export function deleteNutrition(db: Db, date: string) {
  db.run('UPDATE nutrition_day SET deleted_at = ? WHERE date = ?', [now(), date]);
}

export function listNutrition(db: Db, sinceDate?: string): NutritionDay[] {
  return db.all<NutritionDay>(
    `SELECT id, date, calories, protein_g FROM nutrition_day WHERE deleted_at IS NULL ${sinceDate ? 'AND date >= ?' : ''} ORDER BY date`,
    sinceDate ? [sinceDate] : [],
  );
}
