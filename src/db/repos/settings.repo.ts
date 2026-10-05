import { EQUIPMENT, type Equipment, type Intensity, type Settings, type Sex, type Units } from '../../shared/types';
import { lbToKg } from '../../shared/units';
import type { Db, Row } from '../sqlite';

/** Default increments per equipment type, in kg. lb users get 5/10 lb steps, kg users 2/2.5/5 kg. */
export const DEFAULT_INCREMENTS: Record<Units, Record<Equipment, number>> = {
  lb: {
    barbell: lbToKg(5), dumbbell: lbToKg(5), kettlebell: 4, cable: lbToKg(10), machine: lbToKg(10),
    pull_up_bar: lbToKg(5), bodyweight: lbToKg(5), band: lbToKg(5), other: lbToKg(5),
  },
  kg: { barbell: 2.5, dumbbell: 2, kettlebell: 4, cable: 5, machine: 5, pull_up_bar: 2.5, bodyweight: 2.5, band: 2.5, other: 2.5 },
};

export function ensureSettings(db: Db) {
  // Until onboarding asks, assume everything is available.
  db.run(`INSERT OR IGNORE INTO settings (id, default_increment_json, equipment_json) VALUES ('me', ?, ?)`, [
    JSON.stringify(DEFAULT_INCREMENTS.lb), JSON.stringify(EQUIPMENT.filter((e) => e !== 'bodyweight')),
  ]);
}

function toSettings(r: Row): Settings {
  let inc: Partial<Record<Equipment, number>> = {};
  try { inc = JSON.parse(r.default_increment_json as string); } catch { /* defaults below */ }
  const units = r.units as Units;
  let owned: Equipment[] = [];
  let caps: Partial<Record<Equipment, number>> = {};
  try { owned = JSON.parse(r.equipment_json as string); } catch { /* none */ }
  try { caps = JSON.parse(r.equipment_caps_json as string); } catch { /* none */ }
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
    owned_equipment: owned.filter((e) => e !== 'bodyweight'),
    equipment_caps: caps,
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
    else if (k === 'owned_equipment') set('equipment_json', JSON.stringify(v));
    else if (k === 'equipment_caps') set('equipment_caps_json', JSON.stringify(v));
    else set(k, v as string | number | null);
  }
  if (cols.length) db.run(`UPDATE settings SET ${cols.join(', ')} WHERE id = 'me'`, vals);
  return getSettings(db);
}

/** Equipment usable right now: what the user owns plus bodyweight. */
export function availableEquipment(s: Settings): Equipment[] {
  return [...new Set<Equipment>([...s.owned_equipment, 'bodyweight'])];
}

/** Save owned equipment and caps, and apply the caps to every exercise of that type. */
export function setEquipment(db: Db, owned: Equipment[], caps: Partial<Record<Equipment, number | null>>): Settings {
  return db.tx(() => {
    const s = getSettings(db);
    const nextCaps = { ...s.equipment_caps };
    for (const [eq, kg] of Object.entries(caps) as [Equipment, number | null | undefined][]) {
      if (kg === undefined) continue;
      if (kg == null) delete nextCaps[eq]; else nextCaps[eq] = kg;
      db.run(
        `UPDATE exercises SET max_load_kg = ? WHERE equipment = ? AND load_type != 'bodyweight' AND deleted_at IS NULL`,
        [kg, eq],
      );
    }
    return updateSettings(db, { owned_equipment: owned.filter((e) => e !== 'bodyweight'), equipment_caps: nextCaps });
  });
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
