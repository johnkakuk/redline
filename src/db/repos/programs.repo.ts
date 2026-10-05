// Starter programs that fit the equipment the user owns.
import type { Equipment, Exercise } from '../../shared/types';
import type { Db } from '../sqlite';
import { findExerciseByName } from './exercises.repo';
import { saveRoutine, type RoutineItemInput } from './routines.repo';
import { availableEquipment, getSettings } from './settings.repo';
import { newId } from './common';

export type ProgramKind = 'equipment' | 'bodyweight';

interface Slot {
  /** Exercise names in order of preference; the first the user can do wins. */
  pick: string[];
  sets?: number;
  /** Rep target for loaded exercises. */
  reps?: number;
  /** Rep target when the pick is bodyweight-only (default 12). */
  bwReps?: number;
  warmups?: number;
  /** Slots sharing a label become a superset. */
  group?: string;
}

interface Template { name: string; bwName: string; slots: Slot[] }

/** Three full-body days. Every slot that has a bodyweight fallback still works with no equipment. */
const FULL_BODY: Template[] = [
  {
    name: 'Full Body A',
    bwName: 'Bodyweight A',
    slots: [
      { pick: ['Barbell Back Squat', 'Goblet Squat', 'KB Goblet Squat', 'Leg Press', 'Split Squat'], reps: 10, warmups: 2 },
      { pick: ['Barbell Bench Press', 'DB Bench Press', 'Machine Chest Press', 'Push-up'], reps: 10, warmups: 2 },
      { pick: ['Barbell Row', 'Chest-Supported DB Row', 'Seated Cable Row', 'Inverted Row'], reps: 12 },
      { pick: ['Romanian Deadlift', 'DB RDL', 'KB Swing', 'Glute Bridge'], reps: 12, bwReps: 20 },
      { pick: ['Cable Crunch', 'Plank'], reps: 15, bwReps: 45 },
    ],
  },
  {
    name: 'Full Body B',
    bwName: 'Bodyweight B',
    slots: [
      { pick: ['Deadlift', 'DB Bulgarian Split Squat', 'KB Swing', 'Hack Squat', 'Split Squat'], reps: 8, warmups: 2 },
      { pick: ['Overhead Press', 'DB Shoulder Press', 'KB Clean and Press', 'Machine Shoulder Press', 'Decline Push-up'], reps: 10 },
      { pick: ['Lat Pulldown', 'Pull-up', 'Feet-Elevated Inverted Row'], reps: 12, bwReps: 12 },
      { pick: ['Barbell Hip Thrust', 'DB Hip Thrust', 'Cable Pull-Through', 'Single-Leg Glute Bridge'], reps: 12, bwReps: 20 },
      { pick: ['Barbell Curl', 'DB Curl', 'Cable Curl'], reps: 15, group: 'arms' },
      { pick: ['Triceps Pushdown', 'Overhead DB Triceps Extension', 'Band Triceps Pushdown', 'Dip'], reps: 15, bwReps: 15, group: 'arms' },
    ],
  },
  {
    name: 'Full Body C',
    bwName: 'Bodyweight C',
    slots: [
      { pick: ['Barbell Front Squat', 'DB Bulgarian Split Squat', 'KB Goblet Squat', 'Leg Press', 'Bodyweight Squat'], reps: 10, bwReps: 25, warmups: 2 },
      { pick: ['Incline Barbell Bench Press', 'Incline DB Press', 'Machine Chest Press', 'Decline Push-up'], reps: 12 },
      { pick: ['One-Arm DB Row', 'Seated Cable Row', 'Pendlay Row', 'Inverted Row'], reps: 12 },
      { pick: ['Lying Leg Curl', 'Single-Leg DB RDL', 'Good Morning', 'Single-Leg Glute Bridge'], reps: 12, bwReps: 20 },
      { pick: ['Lateral Raise', 'Cable Lateral Raise'], reps: 15, group: 'delts' },
      { pick: ['Face Pull', 'Rear Delt Fly', 'Band Pull-Apart'], reps: 15, group: 'delts' },
      { pick: ['Hanging Knee Raise', 'Side Plank'], reps: 15, bwReps: 45 },
    ],
  },
];

function pick(db: Db, slot: Slot, available: Set<Equipment>): Exercise | null {
  for (const name of slot.pick) {
    const ex = findExerciseByName(db, name);
    if (ex && !ex.archived && available.has(ex.equipment)) return ex;
  }
  return null;
}

/** Preview the program for the user's equipment without saving it. */
export function previewStarterProgram(db: Db, kind: ProgramKind) {
  const s = getSettings(db);
  const owned = availableEquipment(s);
  // A pull-up bar is still bodyweight training, so the bodyweight program uses one when you have it.
  const available = new Set<Equipment>(kind === 'bodyweight' ? owned.filter((e) => e === 'bodyweight' || e === 'pull_up_bar') : owned);
  const onlyBw = [...available].every((e) => e === 'bodyweight' || e === 'pull_up_bar');
  return FULL_BODY.map((t) => {
    const groups = new Map<string, string>();
    const items: (RoutineItemInput & { name: string })[] = [];
    for (const slot of t.slots) {
      const ex = pick(db, slot, available);
      if (!ex) continue;
      const bw = ex.load_type === 'bodyweight';
      const target = bw ? slot.bwReps ?? 12 : slot.reps ?? 10;
      let group_id: string | null = null;
      if (slot.group) group_id = groups.get(slot.group) ?? groups.set(slot.group, newId()).get(slot.group)!;
      items.push({
        name: ex.name,
        exercise_id: ex.id,
        working_sets: slot.sets ?? 3,
        rep_min: target,
        rep_max: target,
        warmup_sets: !bw && ex.equipment === 'barbell' ? slot.warmups ?? 0 : 0,
        group_id,
      });
    }
    return { name: onlyBw ? t.bwName : t.name, items };
  });
}

/** Create the three starter routines. Returns their ids. */
export function createStarterProgram(db: Db, kind: ProgramKind): string[] {
  return db.tx(() =>
    previewStarterProgram(db, kind).map((r) =>
      saveRoutine(db, { name: r.name, items: r.items.map(({ name: _n, ...i }) => i) }),
    ),
  );
}
