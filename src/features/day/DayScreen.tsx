import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { act, useSettings, useUnits } from '../../app/queries';
import { db } from '../../db/client';
import { addDays, fmtDay, localDate, parseLocalDate, workoutMeta } from '../../shared/time';
import { KeypadSheet } from '../../ui/Keypad';
import { Plus } from 'lucide-react';
import { Button, ListRow } from '../../ui/primitives';
import { FoodLogList } from '../nutrition/FoodLogList';
import { LogFoodSheet } from '../nutrition/LogFoodSheet';
import { PushScreen } from '../../ui/Screen';

type Edit = null | 'food' | 'bodyweight';

/** One calendar day: nutrition and bodyweight (editable) and the workouts logged that day. */
export function DayScreen() {
  const { date = '' } = useParams();
  const nav = useNavigate();
  const { w, units, toDisplay, toKg } = useUnits();
  const settings = useSettings().data;
  const [edit, setEdit] = useState<Edit>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const today = localDate();
  const start = valid ? parseLocalDate(date) : new Date();
  const { data } = useQuery({
    queryKey: ['day', date],
    enabled: valid && date <= today,
    queryFn: async () => ({
      nutrition: await db.getNutrition(date),
      bodyweight: (await db.listBodyweight(date)).filter((e) => e.date === date).at(-1) ?? null,
      workouts: await db.listWorkouts({ fromIso: start.toISOString(), toIso: addDays(start, 1).toISOString(), limit: 20 }),
    }),
  });
  // No logging into the future.
  if (!valid || date > today) return <Navigate to={`/day/${today}`} replace />;

  const title = date === today ? 'Today' : fmtDay(date, { weekday: 'long', month: 'short', day: 'numeric' });
  const n = data?.nutrition;
  const bw = data?.bodyweight;
  const workouts = [...(data?.workouts ?? [])].reverse(); // morning first

  const saveBodyweight = async (v: number | null) => {
    if (v == null || v <= 0) { if (bw) await act(db.deleteBodyweight(bw.id)); return; }
    if (bw) await act(db.updateBodyweight(bw.id, { date, weight_kg: toKg(v)!, note: bw.note }));
    else await act(db.logBodyweight({ date, weight_kg: toKg(v)! }));
  };

  return (
    <PushScreen title={date === today ? 'Today' : fmtDay(date, { month: 'short', day: 'numeric' })}>
      <h1 className="title">{title}</h1>
      {date !== today && <div className="caption" style={{ marginTop: 4 }}>{fmtDay(date, { year: 'numeric', month: 'long', day: 'numeric' })}</div>}

      <div className="section">
        <div className="section-label"><span className="micro">Nutrition</span><span className="caption">Tap to log food</span></div>
        <div className="quick" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <button type="button" onClick={() => setEdit('food')} aria-label="Calories">
            <span className="micro">Calories</span>
            <span className={`num ${n?.calories == null ? 'placeholder' : ''}`}>{n?.calories ?? '—'}</span>
            {settings?.calorie_target ? <span className="caption">of {settings.calorie_target}</span> : null}
          </button>
          <button type="button" onClick={() => setEdit('food')} aria-label="Protein">
            <span className="micro">Protein</span>
            <span className={`num ${n?.protein_g == null ? 'placeholder' : ''}`}>{n?.protein_g ?? '—'}{n?.protein_g != null && <span className="unit">g</span>}</span>
            {settings?.protein_target_g ? <span className="caption">of {settings.protein_target_g} g</span> : null}
          </button>
          <button type="button" onClick={() => setEdit('bodyweight')} aria-label="Bodyweight">
            <span className="micro">Weight</span>
            <span className={`num ${bw ? '' : 'placeholder'}`}>{bw ? <>{w(bw.weight_kg)}<span className="unit">{units}</span></> : '—'}</span>
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-label">
          <span className="micro">Food</span>
          <Button variant="ghost" size="sm" onClick={() => setEdit('food')}><Plus size={16} />Log food</Button>
        </div>
        <FoodLogList date={date} empty="Nothing logged this day." />
      </div>

      <div className="section">
        <div className="section-label"><span className="micro">Workouts</span></div>
        {workouts.length ? (
          <div className="list">
            {workouts.map((x) => (
              <ListRow key={x.id} title={x.name} onClick={() => nav(`/history/${x.id}`)}
                sub={`${new Date(x.started_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${workoutMeta(x, (kg) => toDisplay(kg) ?? 0, units)}`} />
            ))}
          </div>
        ) : (
          <div className="card"><p className="muted">{date === today ? 'No workout yet today.' : 'Rest day. No workout logged.'}</p></div>
        )}
      </div>

      <LogFoodSheet open={edit === 'food'} onClose={() => setEdit(null)} date={date} />
      <KeypadSheet open={edit === 'bodyweight'} title="Bodyweight" subtitle={title} nextLabel="Save" onClose={() => setEdit(null)}
        fields={[{ key: 'v', label: 'Bodyweight · empty clears', unit: units, decimals: true, value: bw ? toDisplay(bw.weight_kg) : null, step: units === 'lb' ? 0.5 : 0.1 }]}
        onDone={(v) => { setEdit(null); void saveBodyweight(v.v); }} />
    </PushScreen>
  );
}
