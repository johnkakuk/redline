import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { act } from '../../app/queries';
import { db } from '../../db/client';
import { EQUIPMENT_LABEL, MUSCLE_LABEL } from '../../shared/labels';
import { relativeDays } from '../../shared/time';
import { Button, EmptyState, ListRow, Segmented } from '../../ui/primitives';
import { Screen } from '../../ui/Screen';
import { SortableList } from '../../ui/Sortable';
import { ExerciseFilters, useExerciseFilters } from '../exercises/ExercisePicker';
import { StarterProgramSheet } from '../onboarding/equipment';

export function RoutinesScreen() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'exercises' ? 'exercises' : 'routines';
  const nav = useNavigate();
  return (
    <Screen title={tab === 'routines' ? 'Routines' : 'Exercises'} action={
      <button type="button" className="icon-btn" style={{ color: 'var(--red-400)' }} aria-label={tab === 'routines' ? 'New routine' : 'New exercise'}
        onClick={() => nav(tab === 'routines' ? '/routines/new' : '/exercises/new/edit')}><Plus size={26} /></button>
    }>
      <Segmented value={tab} options={[{ value: 'routines', label: 'Routines' }, { value: 'exercises', label: 'Exercises' }]}
        onChange={(v) => setParams(v === 'exercises' ? { tab: v } : {}, { replace: true })} />
      <div style={{ marginTop: 16 }}>{tab === 'routines' ? <RoutineList /> : <ExerciseLibrary />}</div>
    </Screen>
  );
}

function RoutineList() {
  const nav = useNavigate();
  const all = useQuery({ queryKey: ['routines', 'all'], queryFn: () => db.listRoutines(true) }).data;
  const [showArchived, setShowArchived] = useState(false);
  const [starter, setStarter] = useState(false);
  if (!all) return null;
  const active = all.filter((r) => !r.archived);
  const archived = all.filter((r) => r.archived);
  return (
    <>
      {active.length === 0 && <EmptyState text="No routines yet." action={
        <div className="stack-sm">
          <Button block onClick={() => setStarter(true)}>Use a starter program</Button>
          <Button block variant="secondary" onClick={() => nav('/routines/new')}><Plus size={18} />Create routine</Button>
        </div>} />}
      <StarterProgramSheet open={starter} onClose={() => setStarter(false)} />
      <SortableList items={active} onReorder={(ids) => void act(db.reorderRoutines(ids))}
        render={(r, handle) => (
          <div className="card flush row" style={{ paddingRight: 4 }}>
            <button type="button" className="list-row grow" onClick={() => nav(`/routines/${r.id}`)}>
              <div className="lr-main">
                <div className="lr-title" style={{ fontWeight: 600 }}>{r.name}</div>
                <div className="lr-sub">{r.exercise_count} exercises · {r.set_count} sets{r.last_done_at ? ` · ${relativeDays(r.last_done_at)}` : ''}</div>
              </div>
              <ChevronRight size={18} className="chev" />
            </button>
            {handle}
          </div>
        )} />
      {archived.length > 0 && (
        <div className="section">
          <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'Hide' : 'Show'} archived ({archived.length})</Button>
          {showArchived && (
            <div className="list" style={{ marginTop: 8 }}>
              {archived.map((r) => <ListRow key={r.id} title={<span className="muted">{r.name}</span>} sub="Archived" onClick={() => nav(`/routines/${r.id}`)} />)}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ExerciseLibrary() {
  const f = useExerciseFilters();
  const nav = useNavigate();
  return (
    <>
      <ExerciseFilters f={f} />
      <div className="list" style={{ marginTop: 12 }}>
        {f.list.map((e) => (
          <ListRow key={e.id} title={e.name} onClick={() => nav(`/exercises/${e.id}`)}
            sub={`${MUSCLE_LABEL[e.primary_muscle]} · ${EQUIPMENT_LABEL[e.equipment]}`}
            value={e.max_load_kg != null ? <Lock size={14} /> : undefined} />
        ))}
        {f.list.length === 0 && <div className="list-row muted">No matches.</div>}
      </div>
    </>
  );
}
