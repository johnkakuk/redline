import type { Equipment, Intensity, Settings, Sex, Units } from '../../shared/types';
import { lbToKg } from '../../shared/units';
import type { Db, Row } from '../sqlite';

/** Default increments per equipment type, in kg. lb users get 5/10 lb steps, kg users 2/2.5/5 kg. */
export const DEFAULT_INCREMENTS: Record<Units, Record<Equipment, number>> = {
  lb: {
    barbell: lbToKg(5), dumbbell: lbToKg(5), kettlebell: 4, cable: lbToKg(10), machine: lbToKg(10),
    bodyweight: lbToKg(5), band: lbToKg(5), other: lbToKg(5),
  },
  kg: { barbell: 2.5, dumbbell: 2, kettlebell: 4, cable: 5, machine: 5, bodyweight: 2.5, band: 2.5, other: 2.5 },
};

export function ensureSettings(db: Db) {
  db.run(`INSERT OR IGNORE INTO settings (id, default_increment_json) VALUES ('me', ?)`, [JSON.stringify(DEFAULT_INCREMENTS.lb)]);
}

function toSettings(r: Row): Settings {
  let inc: Partial<Record<Equipment, number>> = {};
  try { inc = JSON.parse(r.default_increment_json as string); } catch { /* defaults below */ }
  const units = r.units as Units;
  return {
    units,
    sex: (r.sex as Sex | null) ?? null,
    birth_date: (r.birth_date as string | null) ?? null,
    height_cm: (r.height_cm as number | null) ?? null,
    default_rest_sec: r.default_rest_sec as number,
    calorie_intensity: r.calorie_intensity as Intensity,
    protein_target_g: (r.protein_target_g as number | null) ?? null,
    calorie_target: (r.calorie_target as number | null) ?? null,
    weekly_target: r.weekly_target as number,
    default_increment: { ...DEFAULT_INCREMENTS[units], ...inc },
    onboarded: r.onboarded === 1,
    last_export_at: (r.last_export_at as string | null) ?? null,
  };
}

export function getSettings(db: Db): Settings {
  ensureSettings(db);
  return toSettings(db.get("SELECT * FROM settings WHERE id = 'me'")!);
}

export function updateSettings(db: Db, patch: Partial<Settings>): Settings {
  const cols: string[] = [];
  const vals: (string | number | null)[] = [];
  const set = (c: string, v: string | number | null) => { cols.push(`${c} = ?`); vals.push(v); };
  for (const [k, v] of Object.entries(patch) as [keyof Settings, unknown][]) {
    if (k === 'default_increment') set('default_increment_json', JSON.stringify(v));
    else if (k === 'onboarded') set('onboarded', v ? 1 : 0);
    else set(k, v as string | number | null);
  }
  if (cols.length) db.run(`UPDATE settings SET ${cols.join(', ')} WHERE id = 'me'`, vals);
  return getSettings(db);
}

/**
 * Switch units. Stored kg values are untouched; increments that still sit at the old unit's defaults
 * are moved to the new unit's defaults so steppers produce round numbers.
 */
export function setUnits(db: Db, units: Units): Settings {
  const s = getSettings(db);
  if (s.units === units) return s;
  db.tx(() => {
    const from = DEFAULT_INCREMENTS[s.units];
    const to = DEFAULT_INCREMENTS[units];
    const inc = { ...s.default_increment };
    for (const eq of Object.keys(to) as Equipment[]) {
      if (Math.abs((inc[eq] ?? 0) - from[eq]) < 1e-6) inc[eq] = to[eq];
      db.run(
        'UPDATE exercises SET default_increment_kg = ? WHERE equipment = ? AND abs(default_increment_kg - ?) < 1e-6',
        [to[eq], eq, from[eq]],
      );
    }
    updateSettings(db, { units, default_increment: inc });
  });
  return getSettings(db);
}
