import { useQuery } from '@tanstack/react-query';
import { Check, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/client';
import { EQUIPMENT_LABEL, MUSCLE_LABEL } from '../../shared/labels';
import { EQUIPMENT, MUSCLES, type Equipment, type Muscle } from '../../shared/types';
import { Chip, ListRow } from '../../ui/primitives';
import { Sheet } from '../../ui/Sheet';

export function useExerciseFilters() {
  const [search, setSearch] = useState('');
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const q = useQuery({ queryKey: ['exercises', search, muscle, equipment], queryFn: () => db.listExercises({ search, muscle, equipment }), placeholderData: (p) => p });
  return { search, setSearch, muscle, setMuscle, equipment, setEquipment, list: q.data ?? [] };
}

export function ExerciseFilters({ f }: { f: ReturnType<typeof useExerciseFilters> }) {
  return (
    <div className="stack-sm">
      <div className="search">
        <Search size={18} />
        <input className="input" type="search" placeholder="Search exercises" value={f.search} onChange={(e) => f.setSearch(e.target.value)} aria-label="Search exercises" />
      </div>
      <div className="chips">
        {EQUIPMENT.map((e) => <Chip key={e} on={f.equipment === e} onClick={() => f.setEquipment(f.equipment === e ? null : e)}>{EQUIPMENT_LABEL[e]}</Chip>)}
      </div>
      <div className="chips">
        {MUSCLES.map((m) => <Chip key={m} on={f.muscle === m} onClick={() => f.setMuscle(f.muscle === m ? null : m)}>{MUSCLE_LABEL[m]}</Chip>)}
      </div>
    </div>
  );
}

/** Exercise picker sheet with search + muscle/equipment filters. Multi-select unless `single`. */
export function ExercisePicker({ open, onClose, onPick, single, title = 'Add exercises' }: {
  open: boolean; onClose: () => void; onPick: (ids: string[]) => void; single?: boolean; title?: string;
}) {
  const f = useExerciseFilters();
  const [sel, setSel] = useState<string[]>([]);
  const nav = useNavigate();
  useEffect(() => { if (open) setSel([]); }, [open]);
  const toggle = (id: string) => {
    if (single) { onPick([id]); onClose(); return; }
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  return (
    <Sheet open={open} onClose={onClose} full title={title}
      left={<button type="button" className="navbtn" onClick={onClose}>Cancel</button>}
      right={!single && <button type="button" className="navbtn strong" disabled={!sel.length} onClick={() => { onPick(sel); onClose(); }}>Add{sel.length ? ` (${sel.length})` : ''}</button>}>
      <ExerciseFilters f={f} />
      <div className="list" style={{ marginTop: 12 }}>
        {f.list.map((e) => {
          const i = sel.indexOf(e.id);
          return (
            <ListRow key={e.id} title={e.name} sub={`${MUSCLE_LABEL[e.primary_muscle]} · ${EQUIPMENT_LABEL[e.equipment]}`} onClick={() => toggle(e.id)} chevron={false}
              selected={i >= 0} trailing={!single && <span className={`select-dot ${i >= 0 ? 'on' : ''}`}>{i >= 0 && <Check size={14} strokeWidth={3} />}</span>} />
          );
        })}
        <ListRow title={<span className="red">New exercise</span>} leading={<Plus size={18} color="var(--red-400)" />} onClick={() => { onClose(); nav('/exercises/new/edit'); }} />
      </div>
    </Sheet>
  );
}
