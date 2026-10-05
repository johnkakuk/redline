import { useQuery } from '@tanstack/react-query';
import { ArrowUpDown, Ellipsis, Plus, StickyNote, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { act, queryClient, useActiveWorkoutId, useUnits } from '../../app/queries';
import { db } from '../../db/client';
import { fmtDay, fmtDuration } from '../../shared/time';
import type { WorkoutExerciseFull, WorkoutFull, WorkoutSet } from '../../shared/types';
import { KeypadSheet, type KeypadField, type KeypadValues } from '../../ui/Keypad';
import { Button, EmptyState } from '../../ui/primitives';
import { ActionSheet, ConfirmSheet, Sheet } from '../../ui/Sheet';
import { SortableList } from '../../ui/Sortable';
import { toast, toastError } from '../../ui/toast';
import { PR_LABEL } from '../../engine/prs';
import { ExercisePicker } from '../exercises/ExercisePicker';
import { ExerciseCard, SupersetLabel, type CardHandlers } from './ExerciseCard';
import { blocksOf, currentStep, nextStepAfter } from './flow';
import { RestTimer } from './RestTimer';
import { useRest, useWakeLock } from './restStore';
import { useElapsed } from './useElapsed';

type Edit = { weId: string; setId: string; field: 'weight' | 'reps' };

export function WorkoutScreen() {
  const id = useActiveWorkoutId();
  const activeLoaded = useQuery({ queryKey: ['active-id'], queryFn: () => db.getActiveWorkoutId() }).isFetched;
  const { data: w } = useQuery({ queryKey: ['workout', id], queryFn: () => db.getWorkout(id!), enabled: !!id });
  if (activeLoaded && !id) return <Navigate to="/" replace />;
  if (!w) return <div className="screen no-tabs" aria-busy="true" />;
  return <LiveWorkout w={w} />;
}

function LiveWorkout({ w }: { w: WorkoutFull }) {
  const nav = useNavigate();
  const { w: fw, units, toDisplay, toKg } = useUnits();
  const elapsed = useElapsed(w.started_at);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [prSets, setPrSets] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState<null | { mode: 'add' } | { mode: 'swap'; weId: string }>(null);
  const [confirm, setConfirm] = useState<null | 'finish' | 'discard' | 'empty'>(null);
  const [reorder, setReorder] = useState(false);
  const [notes, setNotes] = useState<null | { weId?: string; text: string }>(null);
  const [historyFor, setHistoryFor] = useState<WorkoutExerciseFull | null>(null);
  const [targetFor, setTargetFor] = useState<WorkoutExerciseFull | null>(null);
  const startRest = useRest((s) => s.start);
  useWakeLock(true);

  const key = ['workout', w.id];
  const current = useMemo(() => currentStep(w), [w]);
  const blocks = useMemo(() => blocksOf(w.exercises), [w.exercises]);

  const patchSet = (setId: string, patch: Partial<WorkoutSet>) =>
    queryClient.setQueryData<WorkoutFull>(key, (old) => old && {
      ...old,
      exercises: old.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) })),
    });

  const refresh = () => queryClient.invalidateQueries();

  const scrollToSet = (setId: string) => {
    requestAnimationFrame(() => document.querySelector(`[data-set="${setId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const complete = async (we: WorkoutExerciseFull, s: WorkoutSet) => {
    const weight = s.weight_kg ?? s.suggested_weight_kg;
    const reps = s.reps ?? s.suggested_reps;
    if (reps == null) { setEdit({ weId: we.id, setId: s.id, field: 'reps' }); return; }
    if (weight == null && we.exercise.load_type !== 'bodyweight' && we.exercise.load_type !== 'bodyweight_plus') {
      setEdit({ weId: we.id, setId: s.id, field: 'weight' });
      return;
    }
    patchSet(s.id, { completed_at: new Date().toISOString(), weight_kg: weight, reps });
    const next = nextStepAfter(w, s.id);
    // Supersets: rest only after the last exercise in the group for this round.
    const sameGroupNext = !!(next && we.group_id && next.groupId === we.group_id && next.weId !== we.id);
    if (s.kind === 'working' && !sameGroupNext) startRest(we.rest_sec, we.exercise.name);
    if (next) scrollToSet(next.setId);
    try {
      const { prs } = await db.completeSet(s.id);
      if (prs.length) {
        setPrSets((p) => new Set(p).add(s.id));
        const pr = prs[0];
        toast(`${PR_LABEL[pr.type]} · ${we.exercise.name}${pr.weight_kg != null ? ` ${fw(pr.weight_kg)} × ${pr.reps}` : ` ${pr.reps} reps`}`, 'pr');
      }
    } catch (e) {
      toastError(e);
    }
    void refresh();
  };

  const h: CardHandlers = {
    onEdit: (we, s, field) => setEdit({ weId: we.id, setId: s.id, field }),
    onToggle: (we, s) => {
      if (s.completed_at) {
        patchSet(s.id, { completed_at: null });
        setPrSets((p) => { const n = new Set(p); n.delete(s.id); return n; });
        void act(db.uncompleteSet(s.id));
      } else void complete(we, s);
    },
    onAddSet: (we) => void act(db.addSet(we.id, 'working')),
    onRemoveSet: (s) => void act(db.removeSet(s.id)),
    onMenu: (we, a) => {
      if (a === 'swap') setPicker({ mode: 'swap', weId: we.id });
      if (a === 'notes') setNotes({ weId: we.id, text: we.notes ?? '' });
      if (a === 'history') setHistoryFor(we);
      if (a === 'targets') setTargetFor(we);
      if (a === 'pin' && we.item) void act(db.setPinned(we.item.id, !we.state?.pinned)).then(() => toast(we.state?.pinned ? 'Target unpinned' : 'Target pinned'));
      if (a === 'warmups') void act(db.addWarmups(we.id));
      if (a === 'remove') void act(db.removeWorkoutExercise(we.id));
    },
  };

  // Keypad wiring
  const editWe = edit ? w.exercises.find((e) => e.id === edit.weId) : undefined;
  const editSet = editWe?.sets.find((s) => s.id === edit?.setId);
  const fields: KeypadField[] = [];
  if (editWe && editSet) {
    if (editWe.exercise.load_type !== 'bodyweight') {
      const cap = editWe.cap_kg != null ? toDisplay(editWe.cap_kg) : null;
      fields.push({
        key: 'weight', label: 'Weight', unit: units, decimals: true,
        value: toDisplay(editSet.weight_kg), placeholder: toDisplay(editSet.suggested_weight_kg),
        step: toDisplay(editWe.increment_kg) ?? 5, max: cap, maxHint: cap != null ? `Max ${cap} ${units}` : undefined,
      });
    }
    fields.push({ key: 'reps', label: 'Reps', value: editSet.reps, placeholder: editSet.suggested_reps, step: 1, max: 999 });
  }

  const save = async (v: KeypadValues) => {
    if (!editSet || !editWe) return;
    const patch: { weight_kg?: number | null; reps?: number | null } = {};
    if ('weight' in v && v.weight != null) patch.weight_kg = toKg(v.weight);
    if (v.reps != null) patch.reps = v.reps;
    if (!Object.keys(patch).length) return;
    patchSet(editSet.id, patch);
    await act(db.updateSet(editSet.id, patch));
  };

  const keypadNext = async (v: KeypadValues) => {
    if (!editSet) return;
    await save(v);
    const fresh = queryClient.getQueryData<WorkoutFull>(key) ?? w;
    const next = nextStepAfter(fresh, editSet.id);
    if (!next) { setEdit(null); return; }
    const nwe = fresh.exercises.find((e) => e.id === next.weId)!;
    setEdit({ weId: next.weId, setId: next.setId, field: nwe.exercise.load_type === 'bodyweight' ? 'reps' : 'weight' });
    scrollToSet(next.setId);
  };

  const pending = w.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.completed_at).length, 0);
  const doneCount = w.exercises.reduce((n, e) => n + e.sets.filter((s) => s.completed_at && s.kind === 'working').length, 0);

  const finish = async () => {
    try {
      await db.finishWorkout(w.id);
      useRest.getState().skip();
      // Leave first: once queries refresh there is no active workout and this screen would redirect home.
      nav(`/workout/${w.id}/summary`, { replace: true });
      void queryClient.invalidateQueries();
    } catch (e) {
      if (e instanceof Error && /No sets/.test(e.message)) setConfirm('empty');
      else toastError(e);
    }
  };

  const discard = async () => {
    await act(db.discardWorkout(w.id));
    useRest.getState().skip();
    nav('/', { replace: true });
  };

  useEffect(() => {
    const el = document.documentElement;
    el.style.overscrollBehavior = 'none';
    return () => { el.style.overscrollBehavior = ''; };
  }, []);

  return (
    <div className="screen no-tabs wk-screen" style={{ paddingBottom: 'calc(var(--safe-bottom) + 96px)' }}>
      <div className="wk-head">
        <div className="grow">
          <div className="micro ellipsis">{w.name}</div>
          <div className="num" aria-label="Elapsed">{fmtDuration(elapsed)}</div>
        </div>
        <button type="button" className="icon-btn" aria-label="Workout options" onClick={() => setMenu(true)}><Ellipsis size={22} /></button>
        <Button size="sm" onClick={() => (pending > 0 && doneCount > 0 ? setConfirm('finish') : void finish())}>Finish</Button>
      </div>

      {w.exercises.length === 0 && (
        <EmptyState text="No exercises yet." action={<Button onClick={() => setPicker({ mode: 'add' })}><Plus size={18} />Add exercise</Button>} />
      )}

      {blocks.map((b) =>
        b.letter ? (
          <div className="ss-group" key={b.members[0].id}>
            <SupersetLabel letter={b.letter} />
            {b.members.map((m, i) => (
              <ExerciseCard key={m.id} we={m} label={`${b.letter}${i + 1}`} currentSetId={current?.setId ?? null} prSets={prSets} h={h} />
            ))}
          </div>
        ) : (
          <ExerciseCard key={b.members[0].id} we={b.members[0]} currentSetId={current?.setId ?? null} prSets={prSets} h={h} />
        ),
      )}

      {w.exercises.length > 0 && (
        <Button variant="secondary" block style={{ marginTop: 16 }} onClick={() => setPicker({ mode: 'add' })}><Plus size={18} />Add exercise</Button>
      )}

      <RestTimer />

      <KeypadSheet
        open={!!editSet && fields.length > 0}
        title={editWe?.exercise.name}
        subtitle={editSet ? (editSet.kind === 'warmup' ? 'Warm-up' : `Set ${editWe!.sets.filter((s) => s.kind === 'working').indexOf(editSet) + 1}`) : undefined}
        fields={fields}
        initialField={edit?.field === 'weight' && fields[0]?.key === 'weight' ? 'weight' : 'reps'}
        onClose={() => setEdit(null)}
        onDone={(v) => { void save(v); setEdit(null); }}
        onNext={(v) => void keypadNext(v)}
      />

      <ExercisePicker
        open={!!picker}
        single={picker?.mode === 'swap'}
        title={picker?.mode === 'swap' ? 'Swap exercise' : 'Add exercises'}
        onClose={() => setPicker(null)}
        onPick={async (ids) => {
          if (picker?.mode === 'swap') await act(db.swapExercise(picker.weId, ids[0]));
          else { for (const x of ids) await db.addExercise(w.id, x).catch(toastError); await refresh(); }
        }}
      />

      <ActionSheet open={menu} onClose={() => setMenu(false)} title={`Started ${fmtDay(w.started_at, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`} actions={[
        { label: 'Add exercise', icon: <Plus size={20} />, onSelect: () => setPicker({ mode: 'add' }) },
        { label: 'Reorder exercises', icon: <ArrowUpDown size={20} />, onSelect: () => setReorder(true), hidden: w.exercises.length < 2 },
        { label: 'Workout notes', icon: <StickyNote size={20} />, onSelect: () => setNotes({ text: w.notes ?? '' }) },
        { label: 'Discard workout', icon: <Trash2 size={20} />, danger: true, onSelect: () => setConfirm('discard') },
      ]} />

      <ConfirmSheet open={confirm === 'finish'} onClose={() => setConfirm(null)} title="Finish workout?"
        body={`${pending} unfinished ${pending === 1 ? 'set' : 'sets'} will be dropped.`} confirmLabel="Finish" onConfirm={() => void finish()} />
      <ConfirmSheet open={confirm === 'discard'} onClose={() => setConfirm(null)} title="Discard workout?"
        body="Nothing from this session will be saved or used for progression." confirmLabel="Discard" destructive onConfirm={() => void discard()} />
      <ConfirmSheet open={confirm === 'empty'} onClose={() => setConfirm(null)} title="No sets completed"
        body="Complete at least one set to finish, or discard this workout." confirmLabel="Discard" destructive onConfirm={() => void discard()} />

      <Sheet open={reorder} onClose={() => setReorder(false)} title="Reorder" right={<button type="button" className="navbtn strong" onClick={() => setReorder(false)}>Done</button>}>
        <SortableList items={w.exercises} onReorder={(ids) => void act(db.reorderWorkoutExercises(ids))}
          render={(e, handle) => (
            <div className="card tight row" style={{ paddingRight: 4 }}>
              <span className="grow ellipsis">{e.exercise.name}</span>{handle}
            </div>
          )} />
      </Sheet>

      <Sheet open={!!notes} onClose={() => setNotes(null)} title="Notes"
        right={<button type="button" className="navbtn strong" onClick={async () => {
          if (!notes) return;
          if (notes.weId) await act(db.setWorkoutExerciseNotes(notes.weId, notes.text));
          else await act(db.updateWorkoutMeta(w.id, { notes: notes.text }));
          setNotes(null);
        }}>Save</button>}>
        <textarea className="textarea" autoFocus value={notes?.text ?? ''} onChange={(e) => setNotes((n) => n && { ...n, text: e.target.value })} placeholder="Seat height, cues, how it felt…" />
      </Sheet>

      <HistorySheet we={historyFor} onClose={() => setHistoryFor(null)} />

      <KeypadSheet
        open={!!targetFor}
        title="Next target"
        subtitle={targetFor?.exercise.name}
        fields={targetFor ? [
          ...(targetFor.exercise.load_type !== 'bodyweight' ? [{
            key: 'weight', label: 'Weight', unit: units, decimals: true, value: toDisplay(targetFor.state?.target_weight_kg),
            step: toDisplay(targetFor.increment_kg) ?? 5, max: targetFor.cap_kg != null ? toDisplay(targetFor.cap_kg) : null,
            maxHint: targetFor.cap_kg != null ? `Max ${fw(targetFor.cap_kg)} ${units}` : undefined,
          }] : []),
          { key: 'reps', label: 'Reps', value: targetFor.state?.target_reps[0] ?? targetFor.item?.rep_min ?? null, step: 1 },
        ] : []}
        nextLabel="Save"
        onClose={() => setTargetFor(null)}
        onDone={async (v) => {
          if (targetFor?.item) {
            await act(db.setTarget(targetFor.item.id, v.weight != null ? toKg(v.weight) : targetFor.state?.target_weight_kg ?? null,
              v.reps != null ? Array(targetFor.item.working_sets).fill(v.reps) : null));
            toast('Target saved for next session');
          }
          setTargetFor(null);
        }}
      />
    </div>
  );
}

function HistorySheet({ we, onClose }: { we: WorkoutExerciseFull | null; onClose: () => void }) {
  const { w } = useUnits();
  const { data } = useQuery({ queryKey: ['history', we?.exercise_id], queryFn: () => db.exerciseHistory(we!.exercise_id, 10), enabled: !!we });
  return (
    <Sheet open={!!we} onClose={onClose} title={we?.exercise.name} right={<button type="button" className="navbtn" onClick={onClose}>Close</button>}>
      {!data?.length && <p className="muted center" style={{ padding: 24 }}>No history yet.</p>}
      <div className="list">
        {data?.map((h) => (
          <div className="list-row" key={h.workout_id}>
            <div className="lr-main">
              <div className="lr-title">{fmtDay(h.date, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
              <div className="lr-sub">
                {h.sets.filter((s) => s.kind === 'working').map((s) => (we?.exercise.load_type === 'bodyweight' ? `${s.reps}` : `${w(s.weight_kg)}×${s.reps}`)).join('  ')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
