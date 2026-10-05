import { useQuery } from '@tanstack/react-query';
import { Check, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { notifyWrite, queryClient, useSettings } from '../../app/queries';
import { db } from '../../db/client';
import { EQUIPMENT_LABEL, MUSCLE_LABEL } from '../../shared/labels';
import { EQUIPMENT, MUSCLES, type Equipment, type ExerciseInput, type Muscle } from '../../shared/types';
import { ListRow, Segmented } from '../../ui/primitives';
import { Sheet } from '../../ui/Sheet';
import { toast, toastError } from '../../ui/toast';
import { blankExercise, ExerciseFields } from './ExerciseFields';

export type EquipmentFilter = Equipment[] | 'mine';

/** Search + A–Z sort + equipment and muscle checkbox filters. Equipment defaults to what the user owns. */
export function useExerciseFilters() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'az' | 'za'>('az');
  const [equipmentSel, setEquipment] = useState<EquipmentFilter>('mine');
  const [muscles, setMuscles] = useState<Muscle[]>([]);
  const owned = useSettings().data?.owned_equipment;
  const mine: Equipment[] = [...(owned ?? EQUIPMENT), 'bodyweight', 'other'];
  const equipment: Equipment[] = equipmentSel === 'mine' ? EQUIPMENT.filter((e) => mine.includes(e)) : equipmentSel;
  const allEquipment = equipment.length === EQUIPMENT.length;
  const q = useQuery({
    queryKey: ['exercises', search, sort, equipment, muscles],
    queryFn: () => db.listExercises({ search, sort, equipmentIn: allEquipment ? null : equipment, musclesIn: muscles }),
    placeholderData: (p) => p,
  });
  const isMine = equipment.length === mine.filter((e) => EQUIPMENT.includes(e)).length && equipment.every((e) => mine.includes(e));
  const active = (allEquipment || isMine ? 0 : 1) + (muscles.length ? 1 : 0);
  return {
    search, setSearch, sort, setSort, equipment, setEquipment, muscles, setMuscles, mine, isMine, allEquipment, active,
    list: q.data ?? [],
  };
}

function CheckRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="list-row" role="checkbox" aria-checked={on} onClick={onToggle}>
      <span className={`checkbox ${on ? 'on' : ''}`}><Check size={15} strokeWidth={3} /></span>
      <div className="lr-main"><div className="lr-title">{label}</div></div>
    </button>
  );
}

export function ExerciseFilters({ f }: { f: ReturnType<typeof useExerciseFilters> }) {
  const [open, setOpen] = useState(false);
  const toggleEq = (e: Equipment) => f.setEquipment(f.equipment.includes(e) ? f.equipment.filter((x) => x !== e) : [...f.equipment, e]);
  const toggleM = (m: Muscle) => f.setMuscles(f.muscles.includes(m) ? f.muscles.filter((x) => x !== m) : [...f.muscles, m]);
  const summary = [
    f.allEquipment ? 'All equipment' : f.isMine ? 'My equipment' : `${f.equipment.length} equipment types`,
    f.muscles.length ? f.muscles.map((m) => MUSCLE_LABEL[m]).join(', ') : null,
  ].filter(Boolean).join(' · ');
  return (
    <div className="stack-sm">
      <div className="search">
        <Search size={18} />
        <input className="input" type="search" placeholder="Search exercises" value={f.search} onChange={(e) => f.setSearch(e.target.value)} aria-label="Search exercises" />
      </div>
      <div className="lib-toolbar">
        <Segmented small value={f.sort} onChange={f.setSort} options={[{ value: 'az', label: 'A–Z' }, { value: 'za', label: 'Z–A' }]} />
        <button type="button" className="btn secondary sm filter-btn" onClick={() => setOpen(true)} aria-label="Filter exercises">
          <SlidersHorizontal size={16} />Filter{f.active > 0 && <span className="count">{f.active}</span>}
        </button>
        <span className="caption lib-count">{f.list.length}</span>
      </div>
      <div className="caption ellipsis">{summary}</div>

      <Sheet open={open} onClose={() => setOpen(false)} full title="Filter"
        left={<button type="button" className="navbtn" onClick={() => { f.setEquipment('mine'); f.setMuscles([]); }}>Reset</button>}
        right={<button type="button" className="navbtn strong" onClick={() => setOpen(false)}>Done</button>}>
        <div className="section-label" style={{ marginTop: 4 }}>
          <span className="micro">Equipment</span>
          <span className="filter-actions">
            <button type="button" className="btn ghost sm" onClick={() => f.setEquipment('mine')}>Mine</button>
            <button type="button" className="btn ghost sm" onClick={() => f.setEquipment([...EQUIPMENT])}>All</button>
          </span>
        </div>
        <div className="list" role="group" aria-label="Equipment">
          {EQUIPMENT.map((e) => <CheckRow key={e} label={EQUIPMENT_LABEL[e]} on={f.equipment.includes(e)} onToggle={() => toggleEq(e)} />)}
        </div>
        <div className="section-label section">
          <span className="micro">Muscle groups</span>
          <span className="filter-actions">
            <button type="button" className="btn ghost sm" onClick={() => f.setMuscles([])}>Any</button>
          </span>
        </div>
        <div className="list" role="group" aria-label="Muscle groups">
          {MUSCLES.map((m) => <CheckRow key={m} label={MUSCLE_LABEL[m]} on={f.muscles.includes(m)} onToggle={() => toggleM(m)} />)}
        </div>
        <p className="caption" style={{ marginTop: 8 }}>No muscles checked shows every muscle. Matches main and helper muscles.</p>
      </Sheet>
    </div>
  );
}

/** Inline "New exercise" form on top of the picker, so nothing underneath is lost. */
function NewExerciseSheet({ open, initialName, onClose, onCreated }: {
  open: boolean; initialName: string; onClose: () => void; onCreated: (id: string, name: string) => void;
}) {
  const owned = useSettings().data?.owned_equipment;
  const [f, setF] = useState<ExerciseInput>(() => blankExercise(initialName, owned));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF(blankExercise(initialName, owned)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof ExerciseInput>(k: K, v: ExerciseInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setSaving(true);
    try {
      const id = await db.saveExercise(f);
      await queryClient.invalidateQueries({ queryKey: ['exercises'] });
      notifyWrite();
      toast(`${f.name.trim()} created`, 'success');
      onCreated(id, f.name.trim());
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} full title="New exercise"
      left={<button type="button" className="navbtn" onClick={onClose}>Cancel</button>}
      right={<button type="button" className="navbtn strong" disabled={!f.name.trim() || saving} onClick={() => void save()}>Save</button>}>
      <ExerciseFields f={f} set={set} autoFocus={!initialName} nested />
    </Sheet>
  );
}

/**
 * Exercise picker sheet with search, sort and filters. Multi-select unless `single`; picks are returned
 * in the order they were tapped. "New exercise" creates one inline and selects it.
 */
export function ExercisePicker({ open, onClose, onPick, single, title = 'Add exercises', allowCreate = true }: {
  open: boolean; onClose: () => void; onPick: (ids: string[]) => void; single?: boolean; title?: string; allowCreate?: boolean;
}) {
  const f = useExerciseFilters();
  const [sel, setSel] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (open) { setSel([]); setCreating(false); } }, [open]);
  const toggle = (id: string) => {
    if (single) { onPick([id]); onClose(); return; }
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const created = (id: string, name: string) => {
    setCreating(false);
    if (single) { onPick([id]); onClose(); return; }
    setSel((s) => [...s, id]);
    f.setSearch(name); // show it, selected, even if filters would hide it
    f.setEquipment([...EQUIPMENT]);
  };
  return (
    <Sheet open={open} onClose={onClose} full title={title}
      left={<button type="button" className="navbtn" onClick={onClose}>Cancel</button>}
      right={!single && <button type="button" className="navbtn strong" disabled={!sel.length} onClick={() => { onPick(sel); onClose(); }}>Add{sel.length ? ` (${sel.length})` : ''}</button>}>
      <ExerciseFilters f={f} />
      <div className="list" style={{ marginTop: 12 }}>
        {allowCreate && (
          <ListRow title={<span className="red">{f.search.trim() ? `New exercise “${f.search.trim()}”` : 'New exercise'}</span>}
            leading={<Plus size={18} color="var(--red-400)" />} onClick={() => setCreating(true)} chevron={false} />
        )}
        {f.list.map((e) => {
          const i = sel.indexOf(e.id);
          return (
            <ListRow key={e.id} title={e.name} sub={`${MUSCLE_LABEL[e.primary_muscle]} · ${EQUIPMENT_LABEL[e.equipment]}`} onClick={() => toggle(e.id)} chevron={false}
              selected={i >= 0} trailing={!single && <span className={`select-dot ${i >= 0 ? 'on' : ''}`} aria-label={i >= 0 ? `Selected ${i + 1}` : undefined}>{i >= 0 && <span className="num">{i + 1}</span>}</span>} />
          );
        })}
        {f.list.length === 0 && <div className="list-row muted">No matches{allowCreate ? '. Create it above.' : '.'}</div>}
      </div>
      {allowCreate && <NewExerciseSheet open={creating} initialName={f.search.trim()} onClose={() => setCreating(false)} onCreated={created} />}
    </Sheet>
  );
}
