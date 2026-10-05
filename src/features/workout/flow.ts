import type { WorkoutExerciseFull, WorkoutFull } from '../../shared/types';

export interface Block {
  groupId: string | null;
  letter: string | null;
  members: WorkoutExerciseFull[];
}

/** Consecutive exercises sharing a group_id form a superset block, lettered A, B, C… */
export function blocksOf(exercises: WorkoutExerciseFull[]): Block[] {
  const out: Block[] = [];
  let letter = 0;
  for (const e of exercises) {
    const last = out.at(-1);
    if (e.group_id && last?.groupId === e.group_id) last.members.push(e);
    else out.push({ groupId: e.group_id, letter: null, members: [e] });
  }
  for (const b of out) {
    if (b.members.length > 1) b.letter = String.fromCharCode(65 + letter++);
    else b.groupId = null;
  }
  return out;
}

export interface FlowStep { weId: string; setId: string; groupId: string | null }

/** The order sets are meant to be done in: supersets alternate A1 → A2 → A1 by set index; warm-ups first. */
export function flowOrder(w: WorkoutFull): FlowStep[] {
  const steps: FlowStep[] = [];
  for (const b of blocksOf(w.exercises)) {
    for (const m of b.members) {
      for (const s of m.sets) if (s.kind === 'warmup') steps.push({ weId: m.id, setId: s.id, groupId: b.groupId });
    }
    const working = b.members.map((m) => m.sets.filter((s) => s.kind === 'working'));
    const rounds = Math.max(0, ...working.map((x) => x.length));
    for (let i = 0; i < rounds; i++) {
      b.members.forEach((m, j) => { const s = working[j][i]; if (s) steps.push({ weId: m.id, setId: s.id, groupId: b.groupId }); });
    }
  }
  return steps;
}

export function isDone(w: WorkoutFull, setId: string): boolean {
  for (const e of w.exercises) for (const s of e.sets) if (s.id === setId) return !!s.completed_at;
  return false;
}

/** First set not yet completed, in flow order. */
export function currentStep(w: WorkoutFull): FlowStep | null {
  return flowOrder(w).find((st) => !isDone(w, st.setId)) ?? null;
}

/** Next not-completed step after a given set. */
export function nextStepAfter(w: WorkoutFull, setId: string): FlowStep | null {
  const order = flowOrder(w);
  const i = order.findIndex((s) => s.setId === setId);
  return order.slice(i + 1).find((st) => !isDone(w, st.setId)) ?? order.find((st) => st.setId !== setId && !isDone(w, st.setId)) ?? null;
}
