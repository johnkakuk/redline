import { Check, ChevronDown, ChevronUp, Ellipsis, Flame, History, Pin, PinOff, Play, Plus, Repeat, Square, StickyNote, Target, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useUnits } from '../../app/queries';
import { gt } from '../../engine/rounding';
import type { WorkoutExerciseFull, WorkoutSet } from '../../shared/types';
import { Badge, Button, CheckIcon, PrBadge, StatusBadge } from '../../ui/primitives';
import { Term } from '../../ui/InfoTip';
import { ActionSheet } from '../../ui/Sheet';

export interface CardHandlers {
  onEdit: (we: WorkoutExerciseFull, set: WorkoutSet, field: 'weight' | 'reps') => void;
  onPlay: (we: WorkoutExerciseFull, set: WorkoutSet) => void;
  onStop: (we: WorkoutExerciseFull, set: WorkoutSet) => void;
  onUndo: (we: WorkoutExerciseFull, set: WorkoutSet) => void;
  onAddSet: (we: WorkoutExerciseFull) => void;
  onRemoveSet: (set: WorkoutSet) => void;
  onMenu: (we: WorkoutExerciseFull, action: 'swap' | 'notes' | 'history' | 'targets' | 'pin' | 'warmups' | 'remove') => void;
}

export function targetLine(we: WorkoutExerciseFull, w: (kg: number | null | undefined, u?: boolean) => string, units: string) {
  const parts: string[] = [];
  const working = we.sets.filter((s) => s.kind === 'working').length;
  if (we.item) {
    // Show where this session's reps sit relative to the goal, e.g. "3 × 11 · goal 12".
    const aim = Math.min(...(we.state?.target_reps.length ? we.state.target_reps : [we.item.rep_max]));
    parts.push(aim < we.item.rep_max ? `${we.item.working_sets} × ${aim} · goal ${we.item.rep_max}` : `${we.item.working_sets} × ${we.item.rep_max}`);
  } else parts.push(`${working} sets`);
  const target = we.state?.target_weight_kg ?? we.sets.find((s) => s.kind === 'working')?.suggested_weight_kg;
  const lt = we.exercise.load_type;
  if (lt !== 'bodyweight' && target != null && (lt !== 'bodyweight_plus' || target > 0)) {
    parts.push(`${lt === 'bodyweight_plus' ? '+' : ''}${w(target)} ${units}${lt === 'per_hand' ? '/hand' : ''}`);
  } else if (lt === 'bodyweight' || lt === 'bodyweight_plus') parts.push('bodyweight');
  if (we.cap_kg != null) parts.push(`cap ${w(we.cap_kg)}`);
  return parts.join(' · ');
}

/** Running time of the set in progress, ticking every second. */
function SetClock({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="set-clock num">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

export function ExerciseCard({ we, label, currentSetId, running, prSets, expanded, onToggleExpand, h }: {
  we: WorkoutExerciseFull; label?: string; currentSetId: string | null; running: { setId: string; startedAt: number } | null;
  prSets: Set<string>; expanded: boolean; onToggleExpand: () => void; h: CardHandlers;
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
  let badge = <StatusBadge status={we.state?.status} pinned={we.state?.pinned} loadType={lt} />;
  const lastTop = Math.max(0, ...we.previous.filter((p) => p.kind === 'working').map((p) => p.weight_kg ?? 0));
  const sug = we.sets.find((s) => s.kind === 'working')?.suggested_weight_kg ?? null;
  if (we.state?.status === 'progressing' && !we.state.pinned && sug != null && lastTop > 0 && gt(sug, lastTop)) {
    badge = <StatusBadge status="progressing" label={`+${w(sug - lastTop)}`} />;
  }
  if ((we.state?.status === 'capped' || we.state?.status === 'variation_suggested') && lt !== 'bodyweight') {
    badge = <StatusBadge status="capped" label="Capped" />;
  }

  const working = we.sets.filter((s) => s.kind === 'working');
  const doneCount = working.filter((s) => s.completed_at).length;
  const allDone = working.length > 0 && doneCount === working.length;
  const isCurrent = we.sets.some((s) => s.id === currentSetId);

  let workingIdx = 0;
  let warmIdx = 0;
  return (
    <div className={`ex-card ${isCurrent ? 'is-current' : ''} ${allDone ? 'is-done' : ''}`} data-we={we.id}>
      <div className="ex-head" onClick={(e) => { if (!(e.target as HTMLElement).closest('.icon-btn')) onToggleExpand(); }}>
        <div className="grow">
          <h3>{label && <span className="micro ex-label">{label}</span>}{we.exercise.name}</h3>
          <div className="target">{targetLine(we, w, units)}</div>
        </div>
        {allDone ? <Badge tone="success" icon={<Check />}>Done</Badge> : badge}
        <button type="button" className="icon-btn" aria-label={`${we.exercise.name} options`} onClick={() => setMenu(true)}><Ellipsis size={20} /></button>
      </div>
      {!expanded && working.length > 0 && (
        <button type="button" className="ex-progress" onClick={onToggleExpand} aria-label={`${doneCount} of ${working.length} sets done. Show sets`}>
          {working.map((s) => <i key={s.id} className={s.completed_at ? 'on' : s.id === running?.setId ? 'live' : ''} />)}
          <span className="caption">{doneCount}/{working.length} sets</span>
          <ChevronDown size={16} className="dim" />
        </button>
      )}
      {expanded && (
        <>
          {we.notes && <div className="caption" style={{ marginTop: 6 }}>{we.notes}</div>}
          <div className="set-cols micro" aria-hidden>
            <span /><span style={{ textAlign: 'center' }}>Set</span><span>Previous</span><span>{lt === 'bodyweight' ? '' : lt === 'bodyweight_plus' ? `+${units}` : lt === 'per_hand' ? `${units} ea` : units}</span><span>Reps</span><span />
          </div>
          {we.sets.map((s) => {
            const warm = s.kind === 'warmup';
            const n = warm ? warmIdx++ : workingIdx++;
            const done = !!s.completed_at;
            const live = running?.setId === s.id;
            const weight = s.weight_kg ?? s.suggested_weight_kg;
            const reps = s.reps ?? s.suggested_reps;
            const wTouched = s.weight_kg != null || done;
            const rTouched = s.reps != null || done;
            const isPr = prSets.has(s.id);
            const setName = `Set ${warm ? 'W' : n + 1}`;
            return (
              <div key={s.id} className={`set-row ${done ? 'done' : ''} ${warm ? 'warm' : ''} ${live ? 'live' : currentSetId === s.id ? 'current' : ''}`} data-set={s.id}>
                <button type="button" className="set-x" onClick={() => h.onRemoveSet(s)} aria-label={`Remove ${setName.toLowerCase()}`}><X size={16} /></button>
                <span className="sn">{warm ? 'W' : n + 1}</span>
                <span className="prev">{live ? <SetClock since={running!.startedAt} /> : prevOf(s, n)}</span>
                {lt === 'bodyweight'
                  ? <span className="cell sug" style={{ fontSize: 15 }}>BW</span>
                  : <button type="button" className={`cell ${wTouched ? '' : 'sug'} ${weight == null ? 'empty' : ''}`} onClick={() => h.onEdit(we, s, 'weight')} aria-label={`${setName} weight`}>
                      {weight == null ? '—' : w(weight)}
                    </button>}
                <button type="button" className={`cell ${rTouched ? '' : 'sug'} ${reps == null ? 'empty' : ''}`} onClick={() => h.onEdit(we, s, 'reps')} aria-label={`${setName} reps`}>
                  {reps ?? '—'}
                </button>
                {done ? (
                  <button type="button" className="set-btn done" onClick={() => h.onUndo(we, s)} aria-label="Mark set not done"><CheckIcon /></button>
                ) : live ? (
                  <button type="button" className="set-btn stop" onClick={() => h.onStop(we, s)} aria-label="Finish set"><Square size={16} fill="currentColor" /></button>
                ) : (
                  <button type="button" className={`set-btn play ${currentSetId === s.id ? 'next' : ''}`} onClick={() => h.onPlay(we, s)} aria-label="Start set">
                    <Play size={16} fill="currentColor" />
                  </button>
                )}
                {isPr && <span className="pr-tag"><PrBadge /></span>}
              </div>
            );
          })}
          <div className="set-actions">
            <Button variant="ghost" size="sm" onClick={() => h.onAddSet(we)}><Plus size={16} />Add set</Button>
            <button type="button" className="icon-btn" onClick={onToggleExpand} aria-label={`Collapse ${we.exercise.name}`}><ChevronUp size={18} /></button>
          </div>
        </>
      )}
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
  <div className="ss-label"><Badge tone="red">Superset {letter}</Badge><span className="caption"><Term k="superset">Rest after the last exercise</Term></span></div>
);
