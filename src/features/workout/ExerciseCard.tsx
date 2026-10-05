import { Ellipsis, Flame, History, Pin, PinOff, Plus, Repeat, StickyNote, Target, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useUnits } from '../../app/queries';
import { gt } from '../../engine/rounding';
import type { WorkoutExerciseFull, WorkoutSet } from '../../shared/types';
import { Badge, Button, CheckIcon, PrBadge, StatusBadge } from '../../ui/primitives';
import { ActionSheet } from '../../ui/Sheet';

export interface CardHandlers {
  onEdit: (we: WorkoutExerciseFull, set: WorkoutSet, field: 'weight' | 'reps') => void;
  onToggle: (we: WorkoutExerciseFull, set: WorkoutSet) => void;
  onAddSet: (we: WorkoutExerciseFull) => void;
  onRemoveSet: (set: WorkoutSet) => void;
  onMenu: (we: WorkoutExerciseFull, action: 'swap' | 'notes' | 'history' | 'targets' | 'pin' | 'warmups' | 'remove') => void;
}

export function targetLine(we: WorkoutExerciseFull, w: (kg: number | null | undefined, u?: boolean) => string, units: string) {
  const parts: string[] = [];
  const working = we.sets.filter((s) => s.kind === 'working').length;
  parts.push(we.item ? `${we.item.working_sets} × ${we.item.rep_min}–${we.item.rep_max}` : `${working} sets`);
  const target = we.state?.target_weight_kg ?? we.sets.find((s) => s.kind === 'working')?.suggested_weight_kg;
  const lt = we.exercise.load_type;
  if (lt !== 'bodyweight' && target != null && (lt !== 'bodyweight_plus' || target > 0)) {
    parts.push(`${lt === 'bodyweight_plus' ? '+' : ''}${w(target)} ${units}${lt === 'per_hand' ? '/hand' : ''}`);
  } else if (lt === 'bodyweight' || lt === 'bodyweight_plus') parts.push('bodyweight');
  if (we.cap_kg != null) parts.push(`cap ${w(we.cap_kg)}`);
  return parts.join(' · ');
}

export function ExerciseCard({ we, label, currentSetId, prSets, h }: {
  we: WorkoutExerciseFull; label?: string; currentSetId: string | null; prSets: Set<string>; h: CardHandlers;
}) {
  const { w, units } = useUnits();
  const [menu, setMenu] = useState(false);
  const lt = we.exercise.load_type;
  const prevOf = (s: WorkoutSet, i: number) => {
    const p = we.previous.filter((x) => x.kind === s.kind)[i];
    if (!p) return '—';
    return lt === 'bodyweight' ? `${p.reps} reps` : `${w(p.weight_kg)} × ${p.reps ?? '—'}`;
  };

  // "↑ +5" when this session's suggestion is above last time's top working weight.
  let badge = <StatusBadge status={we.state?.status} pinned={we.state?.pinned} />;
  const lastTop = Math.max(0, ...we.previous.filter((p) => p.kind === 'working').map((p) => p.weight_kg ?? 0));
  const sug = we.sets.find((s) => s.kind === 'working')?.suggested_weight_kg ?? null;
  if (we.state?.status === 'progressing' && !we.state.pinned && sug != null && lastTop > 0 && gt(sug, lastTop)) {
    badge = <StatusBadge status="progressing" label={`+${w(sug - lastTop)}`} />;
  }
  if (we.state?.status === 'capped' || we.state?.status === 'variation_suggested') {
    badge = <StatusBadge status="capped" label={we.cap_kg != null ? `Capped ${w(we.cap_kg)}` : 'Maxed'} />;
  }

  let workingIdx = 0;
  let warmIdx = 0;
  return (
    <div className="ex-card" data-we={we.id}>
      <div className="ex-head">
        <div className="grow">
          <h3>{label && <span className="micro ex-label">{label}</span>}{we.exercise.name}</h3>
          <div className="target">{targetLine(we, w, units)}</div>
        </div>
        {badge}
        <button type="button" className="icon-btn" aria-label={`${we.exercise.name} options`} onClick={() => setMenu(true)}><Ellipsis size={20} /></button>
      </div>
      {we.notes && <div className="caption" style={{ marginTop: 6 }}>{we.notes}</div>}
      <div className="set-cols micro" aria-hidden>
        <span style={{ textAlign: 'center' }}>Set</span><span>Previous</span><span>{lt === 'bodyweight' ? '' : lt === 'bodyweight_plus' ? `+${units}` : units}</span><span>Reps</span><span />
      </div>
      {we.sets.map((s) => {
        const warm = s.kind === 'warmup';
        const n = warm ? warmIdx++ : workingIdx++;
        const done = !!s.completed_at;
        const weight = s.weight_kg ?? s.suggested_weight_kg;
        const reps = s.reps ?? s.suggested_reps;
        const wTouched = s.weight_kg != null || done;
        const rTouched = s.reps != null || done;
        const isPr = prSets.has(s.id);
        return (
          <div key={s.id} className={`set-row ${done ? 'done' : ''} ${warm ? 'warm' : ''} ${currentSetId === s.id ? 'current' : ''}`} data-set={s.id}>
            <span className="sn">{warm ? 'W' : n + 1}</span>
            <span className="prev">{prevOf(s, n)}</span>
            {lt === 'bodyweight'
              ? <span className="cell sug" style={{ fontSize: 15 }}>BW</span>
              : <button type="button" className={`cell ${wTouched ? '' : 'sug'} ${weight == null ? 'empty' : ''}`} onClick={() => h.onEdit(we, s, 'weight')} aria-label={`Set ${warm ? 'W' : n + 1} weight`}>
                  {weight == null ? '—' : w(weight)}
                </button>}
            <button type="button" className={`cell ${rTouched ? '' : 'sug'} ${reps == null ? 'empty' : ''}`} onClick={() => h.onEdit(we, s, 'reps')} aria-label={`Set ${warm ? 'W' : n + 1} reps`}>
              {reps ?? '—'}
            </button>
            <button type="button" className="check" onClick={() => h.onToggle(we, s)} aria-label={done ? 'Mark set not done' : 'Complete set'} aria-pressed={done}>
              <CheckIcon />
            </button>
            {isPr && <span className="pr-tag"><PrBadge /></span>}
          </div>
        );
      })}
      <div className="set-actions">
        <Button variant="ghost" size="sm" onClick={() => h.onAddSet(we)}><Plus size={16} />Add set</Button>
        {we.sets.some((s) => !s.completed_at) && (
          <Button variant="ghost" size="sm" className="swipe-del" onClick={() => {
            const last = [...we.sets].reverse().find((s) => !s.completed_at);
            if (last) h.onRemoveSet(last);
          }}>Remove set</Button>
        )}
      </div>
      <ActionSheet open={menu} onClose={() => setMenu(false)} title={we.exercise.name} actions={[
        { label: 'Add warm-ups', icon: <Flame size={20} />, onSelect: () => h.onMenu(we, 'warmups'), hidden: lt === 'bodyweight' },
        { label: 'Swap exercise', icon: <Repeat size={20} />, onSelect: () => h.onMenu(we, 'swap') },
        { label: 'Edit next target', icon: <Target size={20} />, onSelect: () => h.onMenu(we, 'targets'), hidden: !we.item },
        { label: we.state?.pinned ? 'Unpin target' : 'Pin target', icon: we.state?.pinned ? <PinOff size={20} /> : <Pin size={20} />, onSelect: () => h.onMenu(we, 'pin'), hidden: !we.item },
        { label: 'History', icon: <History size={20} />, onSelect: () => h.onMenu(we, 'history') },
        { label: 'Notes', icon: <StickyNote size={20} />, onSelect: () => h.onMenu(we, 'notes') },
        { label: 'Remove exercise', icon: <Trash2 size={20} />, danger: true, onSelect: () => h.onMenu(we, 'remove') },
      ]} />
    </div>
  );
}

export const SupersetLabel = ({ letter }: { letter: string }) => (
  <div className="ss-label"><Badge tone="red">Superset {letter}</Badge><span className="caption">Rest after the last exercise</span></div>
);
