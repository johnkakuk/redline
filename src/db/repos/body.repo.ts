import type { BodyWeightEntry } from '../../shared/types';
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
