import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Equal, Lock, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { act, useUnits } from '../../app/queries';
import { db } from '../../db/client';
import { PR_LABEL } from '../../engine/prs';
import { fmtDay, fmtMinutes, localDate } from '../../shared/time';
import type { ProgressionChange } from '../../shared/types';
import { fmtCompact } from '../../shared/units';
import { Badge, Button, Card, PrBadge } from '../../ui/primitives';
import { Term } from '../../ui/InfoTip';
import { PushScreen } from '../../ui/Screen';
import { ConfirmSheet } from '../../ui/Sheet';
import { toast } from '../../ui/toast';

function ChangeBadge({ c, w }: { c: ProgressionChange; w: (kg: number | null | undefined, u?: boolean) => string }) {
  if (c.undone) return <Badge tone="neutral" icon={<RotateCcw />}>Undone</Badge>;
  switch (c.kind) {
    case 'up': return <Badge tone="success" icon={<ArrowUp />}>{c.after.target_weight_kg != null ? w(c.after.target_weight_kg, true) : 'Up'}</Badge>;
    case 'hold':
    case 'miss': return <Badge tone="warning" icon={<Equal />}>Hold</Badge>;
    case 'deload': return <Badge tone="warning" icon={<ArrowDown />}>Deload</Badge>;
    case 'capped':
    case 'variation':
      // Bodyweight "capped" = rep target hit (no load to cap).
      return c.after.target_weight_kg == null ? <Badge tone="success" icon={<Check />}>Target hit</Badge> : <Badge tone="capped" icon={<Lock />}>Cap</Badge>;
    case 'baseline': return <Badge tone="neutral">Baseline</Badge>;
    case 'pinned': return <Badge tone="neutral" icon={<Lock />}>Pinned</Badge>;
    default: return <Badge tone="neutral">—</Badge>;
  }
}

export function SummaryScreen({ history }: { history?: boolean }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { w, units } = useUnits();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: s } = useQuery({ queryKey: ['summary', id], queryFn: () => db.getSummary(id!) });
  const { data: full } = useQuery({ queryKey: ['workout', id], queryFn: () => db.getWorkout(id!), enabled: !!history });
  // Quick-log entries (bodyweight, calories, protein) from the same calendar day.
  const day = s ? localDate(s.workout.started_at) : null;
  const { data: dayLog } = useQuery({
    queryKey: ['dayLog', day],
    enabled: !!history && !!day,
    queryFn: async () => ({
      bodyweight: (await db.listBodyweight(day!)).filter((e) => e.date === day).at(-1) ?? null,
      nutrition: await db.getNutrition(day!),
    }),
  });
  if (!s) return <div className="screen" aria-busy="true" />;
  const live = s.changes.filter((c) => !c.undone);
  const prompts = live.filter((c) => c.pending);

  const body = (
    <>
      <div className="micro">{history ? fmtDay(s.workout.started_at, { weekday: 'long', month: 'short', day: 'numeric' }) : 'Workout complete'}</div>
      <h1 className="title" style={{ marginBottom: 16 }}>{s.workout.name}</h1>
      <div className="stats">
        <div className="stat"><span className="micro">Time</span><span className="num">{fmtMinutes(s.workout.active_duration_sec ?? 0)}</span></div>
        <div className="stat"><Term k="tonnage" micro>Tonnage</Term><span className="num">{fmtCompact(Number(w(s.tonnage_kg)))}</span></div>
        <div className="stat"><Term k="kcal" micro>Est. kcal</Term><span className="num">{s.workout.kcal_estimate != null ? Math.round(s.workout.kcal_estimate) : '—'}</span></div>
      </div>
      <div className="caption" style={{ marginTop: 8 }}>
        {s.working_sets} working sets · tonnage in {units}
        {s.workout.kcal_estimate == null ? ' · log bodyweight for a calorie estimate' : !s.calorie_profile_complete ? ' · add sex, age and height in Settings for a better estimate' : ''}
      </div>

      {s.prs.length > 0 && (
        <Card label="PRs" action={<PrBadge>{`${s.prs.length} new`}</PrBadge>} className="section">
          <div className="stack-sm">
            {s.prs.map((p, i) => (
              <div className="row-between" key={i}>
                <span className="callout">{p.exercise_name} <span className="caption">· {PR_LABEL[p.type]}</span></span>
                <span className="num" style={{ fontSize: 20, color: 'var(--pr)' }}>
                  {p.type === 'session_volume' ? `${fmtCompact(Number(w(p.value)))} ${units}` : p.type === 'best_e1rm' ? `${w(p.value)} e1RM` : p.weight_kg != null ? `${w(p.weight_kg)} × ${p.reps}` : `${p.reps} reps`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {prompts.map((c) => (
        <div className="card outlined section" key={`p${c.routine_item_id}`}>
          {c.pending === 'variation' ? (
            <>
              <div className="callout">
                {c.after.target_weight_kg != null ? <>Capped at {w(c.after.target_weight_kg, true)} on {c.exercise_name}. </> : <>Maxed reps on {c.exercise_name}. </>}
                Swap to <b>{c.harder_variation?.name}</b>?
              </div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <Button size="sm" variant="secondary" onClick={() => void act(db.respondVariation(c.routine_item_id, false)).then(() => toast('Holding at cap. Asking again in 2 sessions.'))}>Not yet</Button>
                <Button size="sm" onClick={() => void act(db.respondVariation(c.routine_item_id, true)).then(() => toast(`Swapped to ${c.harder_variation?.name}`, 'success'))}>Swap</Button>
              </div>
            </>
          ) : (
            <>
              <div className="callout">Under target reps 3 sessions running on {c.exercise_name}. Deload to <b>{w(c.pending_weight_kg, true)}</b>?</div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <Button size="sm" variant="secondary" onClick={() => void act(db.respondDeload(c.routine_item_id, false))}>Keep weight</Button>
                <Button size="sm" onClick={() => void act(db.respondDeload(c.routine_item_id, true)).then(() => toast('Deload set for next time', 'success'))}>Deload</Button>
              </div>
            </>
          )}
        </div>
      ))}

      {s.changes.length > 0 && (
        <Card label="Next time" className="section" action={live.length > 0 && !history && (
          <Button variant="ghost" size="sm" onClick={() => void act(db.undoProgression(s.workout.id)).then(() => toast('Progression changes undone'))}><RotateCcw size={14} />Undo</Button>
        )}>
          <ul className="next-list">
            {s.changes.map((c) => (
              <li key={c.routine_item_id}>
                <span className="grow" style={{ textDecoration: c.undone ? 'line-through' : undefined }}>{c.exercise_name}<small>{c.reason}</small></span>
                <ChangeBadge c={c} w={w} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {s.added_exercises.length > 0 && !history && (
        <Card className="section" label="Added this session">
          <div className="callout muted">{s.added_exercises.map((a) => a.name).join(', ')}</div>
          <Button size="sm" variant="secondary" style={{ marginTop: 12 }}
            onClick={() => void act(db.updateRoutineFromWorkout(s.workout.id)).then((n) => n && toast(`Added ${n} to the routine`, 'success'))}>
            Add to routine
          </Button>
        </Card>
      )}

      {history && dayLog && (dayLog.bodyweight || dayLog.nutrition?.calories != null || dayLog.nutrition?.protein_g != null) && (
        <div className="section">
          <div className="section-label"><span className="micro">That day</span></div>
          <div className="stats">
            <div className="stat"><span className="micro">Weight</span>
              <span className="num">{dayLog.bodyweight ? <>{w(dayLog.bodyweight.weight_kg)}<span className="unit">{units}</span></> : '—'}</span></div>
            <div className="stat"><span className="micro">Calories</span><span className="num">{dayLog.nutrition?.calories ?? '—'}</span></div>
            <div className="stat"><span className="micro">Protein</span>
              <span className="num">{dayLog.nutrition?.protein_g != null ? <>{dayLog.nutrition.protein_g}<span className="unit">g</span></> : '—'}</span></div>
          </div>
        </div>
      )}

      {history && full && (
        <div className="section">
          <div className="section-label"><span className="micro">Sets</span></div>
          <div className="list">
            {full.exercises.map((e) => (
              <button type="button" className="list-row" key={e.id} onClick={() => nav(`/exercises/${e.exercise_id}`)}>
                <div className="lr-main">
                  <div className="lr-title">{e.exercise.name}</div>
                  <div className="lr-sub">{e.sets.map((x) => `${x.kind === 'warmup' ? 'W ' : ''}${e.exercise.load_type === 'bodyweight' ? x.reps : `${w(x.weight_kg)}×${x.reps}`}`).join('  ')}</div>
                </div>
              </button>
            ))}
          </div>
          {s.workout.notes && <p className="caption" style={{ marginTop: 12 }}>{s.workout.notes}</p>}
          <Button variant="destructive" block style={{ marginTop: 24 }} onClick={() => setConfirmDelete(true)}><Trash2 size={18} />Delete workout</Button>
          <ConfirmSheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this workout?" destructive confirmLabel="Delete"
            body="It will be removed from history and analytics. Progression targets are not changed."
            onConfirm={() => void act(db.deleteWorkout(s.workout.id)).then(() => nav(-1))} />
        </div>
      )}
    </>
  );

  if (history) return <PushScreen title="Workout">{body}</PushScreen>;
  return (
    <div className="screen no-tabs">
      {body}
      <div className="sticky-bottom">
        <Button block onClick={() => nav('/', { replace: true })}>Done</Button>
      </div>
    </div>
  );
}
