import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Lock } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { act, useSettings, useUnits } from '../../app/queries';
import { db } from '../../db/client';
import { EQUIPMENT_LABEL, LOAD_TYPE_LABEL, MUSCLE_LABEL } from '../../shared/labels';
import { fmtCompact } from '../../shared/units';
import { Badge, Button, ListRow, StatusBadge } from '../../ui/primitives';
import { PushScreen } from '../../ui/Screen';
import { StrengthPanel } from '../progress/StrengthPanel';

export function ExerciseDetailScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const { w, units, toDisplay } = useUnits();
  const settings = useSettings().data;
  const { data: d } = useQuery({ queryKey: ['exerciseDetail', id], queryFn: () => db.exerciseDetail(id!) });
  if (!d) return <PushScreen title="Exercise"><div aria-busy="true" /></PushScreen>;
  const ex = d.exercise;
  const inc = ex.default_increment_kg ?? settings?.default_increment[ex.equipment];
  const bw = ex.load_type === 'bodyweight';

  return (
    <PushScreen title={ex.name} right={<button type="button" className="navbtn" onClick={() => nav(`/exercises/${ex.id}/edit`)}>Edit</button>}>
      <h1 className="title">{ex.name}</h1>
      <div className="caption" style={{ marginTop: 4 }}>
        {MUSCLE_LABEL[ex.primary_muscle]}{ex.secondary_muscles.length ? ` + ${ex.secondary_muscles.map((m) => MUSCLE_LABEL[m]).join(', ')}` : ''}
      </div>
      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <Badge>{EQUIPMENT_LABEL[ex.equipment]}</Badge>
        <Badge>{LOAD_TYPE_LABEL[ex.load_type]}</Badge>
        {!bw && <Badge>{`±${w(inc)} ${units}`}</Badge>}
        {ex.max_load_kg != null && <Badge tone="capped" icon={<Lock />}>{`Max ${w(ex.max_load_kg)} ${units}`}</Badge>}
        {ex.archived && <Badge tone="warning">Archived</Badge>}
      </div>
      {ex.notes && <p className="callout muted" style={{ marginTop: 12 }}>{ex.notes}</p>}

      {!bw && (d.bests.max_weight || d.bests.best_e1rm) && (
        <div className="stats section">
          <div className="stat"><span className="micro">Heaviest</span><span className="num">{w(d.bests.max_weight?.value)}</span></div>
          <div className="stat"><span className="micro">Best e1RM</span><span className="num">{w(d.bests.best_e1rm?.value)}</span></div>
          <div className="stat"><span className="micro">Best volume</span><span className="num">{d.bests.session_volume ? fmtCompact(toDisplay(d.bests.session_volume.value) ?? 0) : '—'}</span></div>
        </div>
      )}

      <div className="section"><StrengthPanel exerciseId={ex.id} /></div>

      {d.routines.length > 0 && (
        <div className="section">
          <div className="section-label"><span className="micro">Current targets</span></div>
          <div className="list">
            {d.routines.map((r) => (
              <ListRow key={r.item_id} title={r.routine_name} onClick={() => nav(`/routines/${r.routine_id}`)}
                sub={`${r.working_sets} × ${r.rep_max}${r.state?.target_weight_kg != null ? ` · next ${w(r.state.target_weight_kg, true)} × ${r.state.target_reps.join('/')}` : ''}`}
                trailing={<StatusBadge status={r.state?.status} pinned={r.state?.pinned} loadType={ex.load_type} />} />
            ))}
          </div>
        </div>
      )}

      {(d.easier || d.harder) && (
        <div className="section">
          <div className="section-label"><span className="micro">Variations</span></div>
          <div className="list">
            {d.easier && <ListRow title={d.easier.name} sub="Easier" leading={<ArrowDown size={18} className="dim" />} onClick={() => nav(`/exercises/${d.easier!.id}`)} />}
            {d.harder && <ListRow title={d.harder.name} sub="Harder" leading={<ArrowUp size={18} className="dim" />} onClick={() => nav(`/exercises/${d.harder!.id}`)} />}
          </div>
        </div>
      )}

      <div className="section">
        <Button variant="secondary" block onClick={() => void act(db.archiveExercise(ex.id, !ex.archived))}>
          {ex.archived ? <><ArchiveRestore size={18} />Unarchive</> : <><Archive size={18} />Archive</>}
        </Button>
      </div>
    </PushScreen>
  );
}
