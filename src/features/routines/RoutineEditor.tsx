import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Check, ChevronDown, ChevronUp, Copy, Layers, Plus, Repeat, Trash2, Unlink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ulid } from 'ulid';
import { act, useSettings, useUnits } from '../../app/queries';
import { db } from '../../db/client';
import type { RoutineItemInput } from '../../db/repos/routines.repo';
import type { Exercise, ProgressionState, RoutineItem } from '../../shared/types';
import { Term } from '../../ui/InfoTip';
import { KeypadSheet } from '../../ui/Keypad';
import { Badge, Button, EmptyState, Field, Segmented, StatusBadge, Stepper, ValueButton } from '../../ui/primitives';
import { PushScreen } from '../../ui/Screen';
import { ConfirmSheet } from '../../ui/Sheet';
import { SortableList } from '../../ui/Sortable';
import { toast } from '../../ui/toast';
import { ExercisePicker } from '../exercises/ExercisePicker';

type Draft = RoutineItemInput & { id: string; exercise: Exercise; state: ProgressionState | null; isNew?: boolean };

const TMP = 'tmp-';

// Unsaved edits are kept on this device until saved or discarded, so leaving the editor
// (or iOS closing the app) never loses work. Per-device convenience only.
interface StoredDraft { name: string; notes: string; items: Draft[]; at: string }
const draftKey = (id: string) => `redline-routine-draft:${id}`;
function readDraft(id: string): StoredDraft | null {
  try { const v = localStorage.getItem(draftKey(id)); return v ? (JSON.parse(v) as StoredDraft) : null; } catch { return null; }
}
function writeDraft(id: string, d: StoredDraft | null) {
  try { if (d) localStorage.setItem(draftKey(id), JSON.stringify(d)); else localStorage.removeItem(draftKey(id)); } catch { /* storage unavailable */ }
}
/** What counts as an edit: everything except display-only exercise/state objects. */
const fingerprint = (name: string, notes: string, items: Draft[]) =>
  JSON.stringify([name, notes, items.map(({ exercise: _e, state: _s, isNew: _n, ...rest }) => rest)]);

function defaultsFor(ex: Exercise): Partial<RoutineItem> {
  if (ex.load_type === 'bodyweight') return { working_sets: 3, rep_min: 8, rep_max: 15 };
  if (ex.equipment === 'barbell' && ex.default_rest_sec && ex.default_rest_sec >= 150) return { working_sets: 3, rep_min: 5, rep_max: 8, warmup_sets: 3 };
  if (['cable', 'machine'].includes(ex.equipment) || ['side_delts', 'biceps', 'triceps', 'calves', 'rear_delts', 'abs'].includes(ex.primary_muscle)) {
    return { working_sets: 3, rep_min: 10, rep_max: 15 };
  }
  return { working_sets: 3, rep_min: 8, rep_max: 12 };
}

export function RoutineEditor() {
  const { id: rawId } = useParams();
  const isNew = rawId === 'new';
  const nav = useNavigate();
  const { data: routine } = useQuery({ queryKey: ['routine', rawId], queryFn: () => db.getRoutine(rawId!), enabled: !isNew });
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Draft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [picker, setPicker] = useState<null | 'add' | { replace: string }>(null);
  const [confirm, setConfirm] = useState<null | 'delete'>(null);
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const key = rawId ?? 'new';

  const apply = (n: string, no: string, it: Draft[]) => { setName(n); setNotes(no); setItems(it); };

  // Load the saved routine (or a blank one), then any unsaved draft on top of it.
  useEffect(() => {
    if (loaded && baseline != null) return;
    if (!isNew && !routine) return;
    const base = { name: routine?.name ?? '', notes: routine?.notes ?? '', items: (routine?.items ?? []).map((i) => ({ ...i }) as Draft) };
    setBaseline(fingerprint(base.name, base.notes, base.items));
    apply(base.name, base.notes, base.items);
    const draft = readDraft(key);
    if (!draft) { setLoaded(true); return; }
    // Refresh exercise details; drop any exercise deleted since the draft was made.
    void Promise.all(draft.items.map((i) => db.getExercise(i.exercise_id).then((exercise) => ({ ...i, exercise })).catch(() => null))).then((its) => {
      apply(draft.name, draft.notes, its.filter((x): x is Draft => x != null));
      setRestored(true);
      setLoaded(true);
    });
  }, [routine, isNew, loaded, baseline, key]);

  const dirty = loaded && baseline != null && fingerprint(name, notes, items) !== baseline;

  // Autosave the draft while there are unsaved changes.
  useEffect(() => {
    if (!loaded) return;
    writeDraft(key, dirty ? { name, notes, items, at: new Date().toISOString() } : null);
  }, [loaded, dirty, name, notes, items, key]);

  const discard = () => {
    writeDraft(key, null);
    setRestored(false);
    setBaseline(null);
    setLoaded(false); // reload from the saved routine
  };

  const leave = () => (dirty ? setLeaving(true) : nav(-1));

  const patch = (id: string, p: Partial<Draft>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = async (ids: string[]) => {
    const exs = await Promise.all(ids.map((x) => db.getExercise(x)));
    setItems((xs) => [...xs, ...exs.map((ex) => ({ id: TMP + ulid(), exercise_id: ex.id, exercise: ex, state: null, isNew: true, ...defaultsFor(ex) }))]);
  };

  const replace = async (itemId: string, exId: string) => {
    const ex = await db.getExercise(exId);
    patch(itemId, { exercise_id: ex.id, exercise: ex, state: null });
  };

  /** Group the selected items as a superset, moving them next to the first selected item. */
  const group = () => {
    const gid = ulid();
    setItems((xs) => {
      const sel = xs.filter((x) => selected.includes(x.id));
      const firstIdx = xs.findIndex((x) => selected.includes(x.id));
      const rest = xs.filter((x) => !selected.includes(x.id));
      const before = xs.slice(0, firstIdx).filter((x) => !selected.includes(x.id)).length;
      return [...rest.slice(0, before), ...sel.map((x) => ({ ...x, group_id: gid })), ...rest.slice(before)];
    });
    setSelected([]);
    setSelecting(false);
  };
  const ungroup = () => {
    setItems((xs) => xs.map((x) => (selected.includes(x.id) ? { ...x, group_id: null } : x)));
    setSelected([]);
    setSelecting(false);
  };

  // Superset labels (A1, A2…) for adjacent items sharing a group.
  const labels = useMemo(() => {
    const out = new Map<string, string>();
    let letter = 0;
    for (let i = 0; i < items.length; i++) {
      const g = items[i].group_id;
      if (!g || (i > 0 && items[i - 1].group_id === g)) continue;
      let j = i;
      while (j < items.length && items[j].group_id === g) j++;
      if (j - i > 1) {
        const L = String.fromCharCode(65 + letter++);
        for (let k = i; k < j; k++) out.set(items[k].id, `${L}${k - i + 1}`);
      }
    }
    return out;
  }, [items]);

  const save = async () => {
    setSaving(true);
    const id = await act(db.saveRoutine({
      id: isNew ? undefined : rawId,
      name,
      notes,
      items: items.map(({ exercise: _e, state: _s, isNew: _n, id, ...rest }) => ({ ...rest, id: id.startsWith(TMP) ? undefined : id })),
    }));
    setSaving(false);
    if (id) {
      writeDraft(key, null);
      setBaseline(fingerprint(name, notes, items)); // stop autosave before leaving
      toast('Routine saved', 'success');
      nav('/routines', { replace: true });
    }
  };

  if (!loaded) return <PushScreen title="Routine"><div aria-busy="true" /></PushScreen>;
  const selGroups = new Set(items.filter((x) => selected.includes(x.id)).map((x) => x.group_id));

  return (
    <PushScreen title={isNew ? 'New routine' : 'Edit routine'} backLabel="Cancel" back={leave}
      right={<button type="button" className="navbtn strong" disabled={saving || !name.trim()} onClick={() => void save()}>Save</button>}>
      {restored && dirty && (
        <div className="banner info" role="status">
          <span className="grow">Restored your unsaved changes.</span>
          <button type="button" className="red" style={{ fontWeight: 600 }} onClick={discard}>Discard</button>
        </div>
      )}
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Upper A · Push" autoFocus={isNew} /></Field>
      <Field label="Notes"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>

      <div className="section">
        <div className="section-label">
          <span className="micro">Exercises · {items.length}</span>
          {items.length > 1 && (
            <Button variant="ghost" size="sm" onClick={() => { setSelecting((v) => !v); setSelected([]); setOpen(null); }}>{selecting ? 'Cancel' : 'Select'}</Button>
          )}
        </div>
        {selecting && <p className="caption" style={{ marginBottom: 8 }}><Term k="superset">Select 2+ exercises to pair as a superset</Term></p>}
        {selecting && (
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <Button size="sm" disabled={selected.length < 2} onClick={group}><Layers size={16} />Group as superset</Button>
            <Button size="sm" variant="secondary" disabled={!selected.length || (selGroups.size === 1 && selGroups.has(null))} onClick={ungroup}><Unlink size={16} />Ungroup</Button>
          </div>
        )}
        {items.length === 0 && <EmptyState text="Add the exercises for this routine." />}
        <SortableList items={items} onReorder={(ids) => setItems((xs) => ids.map((i) => xs.find((x) => x.id === i)!))}
          render={(it, handle) => (
            <ItemCard it={it} handle={handle} label={labels.get(it.id)} open={open === it.id} selecting={selecting} selected={selected.includes(it.id)}
              onToggleOpen={() => (selecting ? setSelected((s) => (s.includes(it.id) ? s.filter((x) => x !== it.id) : [...s, it.id])) : setOpen((o) => (o === it.id ? null : it.id)))}
              onPatch={(p) => patch(it.id, p)} onRemove={() => setItems((xs) => xs.filter((x) => x.id !== it.id))} onReplace={() => setPicker({ replace: it.id })} />
          )} />
        <Button variant="secondary" block style={{ marginTop: 12 }} onClick={() => setPicker('add')}><Plus size={18} />Add exercises</Button>
      </div>

      {!isNew && routine && (
        <div className="section stack-sm">
          <Button variant="secondary" block onClick={async () => { const nid = await act(db.duplicateRoutine(routine.id)); if (nid) { toast('Duplicated'); nav(`/routines/${nid}`, { replace: true }); } }}>
            <Copy size={18} />Duplicate
          </Button>
          <Button variant="secondary" block onClick={async () => { await act(db.archiveRoutine(routine.id, !routine.archived)); nav('/routines', { replace: true }); }}>
            {routine.archived ? <><ArchiveRestore size={18} />Unarchive</> : <><Archive size={18} />Archive</>}
          </Button>
          <Button variant="destructive" block onClick={() => setConfirm('delete')}><Trash2 size={18} />Delete routine</Button>
        </div>
      )}

      <ExercisePicker open={!!picker} single={typeof picker === 'object' && picker !== null} title={picker === 'add' ? 'Add exercises' : 'Change exercise'}
        onClose={() => setPicker(null)} onPick={(ids) => { if (picker === 'add') void add(ids); else if (picker) void replace(picker.replace, ids[0]); }} />
      <ConfirmSheet open={leaving} onClose={() => setLeaving(false)} title="Discard changes?" confirmLabel="Discard" destructive
        body="Your edits to this routine haven’t been saved." onConfirm={() => { writeDraft(key, null); setBaseline(fingerprint(name, notes, items)); nav(-1); }} />
      <ConfirmSheet open={confirm === 'delete'} onClose={() => setConfirm(null)} title="Delete routine?" destructive confirmLabel="Delete"
        body="Past workouts stay in your history." onConfirm={async () => { writeDraft(key, null); await act(db.deleteRoutine(rawId!)); nav('/routines', { replace: true }); }} />
    </PushScreen>
  );
}

function ItemCard({ it, handle, label, open, selecting, selected, onToggleOpen, onPatch, onRemove, onReplace }: {
  it: Draft; handle: React.ReactNode; label?: string; open: boolean; selecting: boolean; selected: boolean;
  onToggleOpen: () => void; onPatch: (p: Partial<Draft>) => void; onRemove: () => void; onReplace: () => void;
}) {
  const { w, units, toDisplay, toKg } = useUnits();
  const settings = useSettings().data;
  const [kp, setKp] = useState<null | 'inc' | 'cap'>(null);
  const ex = it.exercise;
  const ws = it.working_sets ?? 3;
  const rmin = it.rep_min ?? 8;
  const rmax = it.rep_max ?? 12;
  const rest = it.rest_sec ?? ex.default_rest_sec ?? settings?.default_rest_sec ?? 90;
  const defInc = ex.default_increment_kg ?? settings?.default_increment[ex.equipment] ?? null;
  const fmtRest = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`);
  return (
    <div className={`item-card ${selected ? 'selected' : ''} ${label ? 'grouped' : ''}`}>
      <div className="item-head">
        {selecting && <span className={`select-dot ${selected ? 'on' : ''}`} onClick={onToggleOpen}>{selected && <Check size={14} strokeWidth={3} />}</span>}
        <div className="grow" onClick={onToggleOpen} role="button" tabIndex={0} aria-expanded={open}>
          <div style={{ fontWeight: 600 }}>{label && <span className="micro ex-label">{label}</span>}{ex.name}</div>
          <div className="caption">
            {ws} × {rmin}–{rmax}{(it.warmup_sets ?? 0) > 0 ? ` · ${it.warmup_sets} warm-up` : ''} · rest {fmtRest(rest)}
            {it.progression_mode === 'none' ? ' · manual' : ''}
          </div>
        </div>
        {it.state && <StatusBadge status={it.state.status} pinned={it.state.pinned} />}
        {!selecting && (open ? <ChevronUp size={18} className="dim" /> : <ChevronDown size={18} className="dim" />)}
        {handle}
      </div>
      {open && !selecting && (
        <div className="item-body">
          <div className="cfg-grid">
            <div><span className="micro">Working sets</span><Stepper label="sets" value={ws} min={1} max={10} onChange={(v) => onPatch({ working_sets: v })} /></div>
            <div><Term k="warmups" micro>Warm-up sets</Term><Stepper label="warm-ups" value={it.warmup_sets ?? 0} min={0} max={3} onChange={(v) => onPatch({ warmup_sets: v })} /></div>
            <div><Term k="rep_range" micro>Rep min</Term><Stepper label="rep min" value={rmin} min={1} max={50} onChange={(v) => onPatch({ rep_min: v, rep_max: Math.max(v, rmax) })} /></div>
            <div><Term k="rep_range" micro>Rep max</Term><Stepper label="rep max" value={rmax} min={rmin} max={60} onChange={(v) => onPatch({ rep_max: v })} /></div>
            <div><Term k="default_rest" micro>Rest</Term><Stepper label="rest" value={rest} min={0} max={600} step={15} format={fmtRest} onChange={(v) => onPatch({ rest_sec: v })} /></div>
            <div>
              <Term k="progression" micro>Progression</Term>
              <Segmented small value={it.progression_mode ?? 'double'} options={[{ value: 'double', label: 'Double' }, { value: 'none', label: 'Off' }]} onChange={(v) => onPatch({ progression_mode: v })} />
            </div>
            {ex.load_type !== 'bodyweight' && (
              <>
                <div><Term k="increment" micro>Increment</Term>
                  <ValueButton label="Increment" value={it.increment_kg != null ? w(it.increment_kg) : null} unit={units} placeholder={`${w(defInc)} default`} onClick={() => setKp('inc')} />
                </div>
                <div><Term k="cap" micro>Cap override</Term>
                  <ValueButton label="Cap" value={it.max_load_kg != null ? w(it.max_load_kg) : null} unit={units} placeholder={ex.max_load_kg != null ? `${w(ex.max_load_kg)} default` : 'None'} onClick={() => setKp('cap')} />
                </div>
              </>
            )}
          </div>
          <Field label="Notes"><input className="input" value={it.notes ?? ''} onChange={(e) => onPatch({ notes: e.target.value })} placeholder="Cues, seat height…" /></Field>
          {it.state?.target_weight_kg != null && (
            <div className="caption" style={{ marginTop: 10 }}>Next target: {w(it.state.target_weight_kg, true)} × {it.state.target_reps.join('/')}{it.state.pinned && <Badge tone="neutral">Pinned</Badge>}</div>
          )}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <Button size="sm" variant="secondary" onClick={onReplace}><Repeat size={16} />Change</Button>
            <Button size="sm" variant="destructive" onClick={onRemove}><Trash2 size={16} />Remove</Button>
          </div>
          <KeypadSheet open={kp != null} title={kp === 'inc' ? 'Increment' : 'Cap override'} subtitle={ex.name} nextLabel="Save" onClose={() => setKp(null)}
            fields={[{ key: 'v', label: kp === 'inc' ? 'Increment (empty = default)' : 'Max load (empty = default)', unit: units, decimals: true,
              value: toDisplay(kp === 'inc' ? it.increment_kg : it.max_load_kg), step: kp === 'inc' ? 0.5 : toDisplay(defInc) ?? 5 }]}
            onDone={(v) => { onPatch(kp === 'inc' ? { increment_kg: v.v ? toKg(v.v) : null } : { max_load_kg: v.v ? toKg(v.v) : null }); setKp(null); }} />
        </div>
      )}
    </div>
  );
}
