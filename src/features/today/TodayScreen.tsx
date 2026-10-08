import { useQuery } from '@tanstack/react-query';
import { Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { act, useActiveWorkoutId, useSettings, useUnits } from '../../app/queries';
import { db } from '../../db/client';
import { fmtVolume, PR_LABEL } from '../../engine/prs';
import { addDays, fmtDay, localDate } from '../../shared/time';
import { fmtCompact } from '../../shared/units';
import { KeypadSheet } from '../../ui/Keypad';
import { Button, Card, Delta, EmptyState, ListRow, PrBadge } from '../../ui/primitives';
import { Term } from '../../ui/InfoTip';
import { Screen } from '../../ui/Screen';
import { toast } from '../../ui/toast';
import { StarterProgramSheet } from '../onboarding/equipment';
import { useOpenDay } from '../workout/useOpenDay';
import { WeekStrip } from './WeekStrip';
import { LogFoodSheet } from '../nutrition/LogFoodSheet';

export function TodayScreen() {
  const nav = useNavigate();
  const activeId = useActiveWorkoutId();
  const { w, units, toDisplay, toKg } = useUnits();
  const settings = useSettings().data;
  const today = localDate();
  const stats = useQuery({ queryKey: ['weekStats'], queryFn: () => db.weekStats() }).data;
  const next = useQuery({ queryKey: ['nextRoutine'], queryFn: () => db.nextRoutine() }).data;
  const routines = useQuery({ queryKey: ['routines'], queryFn: () => db.listRoutines() }).data ?? [];
  const prs = useQuery({ queryKey: ['recentPrs', 7], queryFn: () => db.recentPrs({ sinceIso: addDays(new Date(), -7).toISOString(), limit: 8 }) }).data ?? [];
  const bw = useQuery({ queryKey: ['latestBw'], queryFn: () => db.latestBodyweightKg() }).data ?? null;
  const nutrition = useQuery({ queryKey: ['nutrition', today], queryFn: () => db.getNutrition(today) }).data;
  const [log, setLog] = useState<null | 'bw' | 'food'>(null);
  const [starter, setStarter] = useState(false);
  const day = useOpenDay();

  const start = async (routineId: string | null) => {
    const id = await act(db.startWorkout({ routineId }));
    if (id) nav('/workout');
  };

  const trained = new Set(stats?.trained_dates ?? []);
  const est = next ? Math.round((next.set_count * (40 + (settings?.default_rest_sec ?? 90))) / 60) : 0;
  const nextIdx = next ? routines.findIndex((r) => r.id === next.id) : -1;
  const cur = stats?.current;
  const prev = stats?.previous;

  return (
    <Screen title="Today" eyebrow={fmtDay(new Date().toISOString(), { weekday: 'long', month: 'short', day: 'numeric' })}>
      <WeekStrip trained={trained} onOpenDay={(d) => void day.open(d)} />

      <div className="section">
        {activeId ? (
          <Card label="In progress">
            <div className="next-name">Workout in progress</div>
            <Button block style={{ marginTop: 12 }} onClick={() => nav('/workout')}><Play size={18} />Resume workout</Button>
          </Card>
        ) : next ? (
          <Card label="Next up" action={routines.length > 1 && <span className="caption">Day {nextIdx + 1} of {routines.length}</span>}>
            <div className="next-name">{next.name}</div>
            <div className="caption">{next.exercise_count} exercises · {next.set_count} sets · ~{est} min</div>
            <Button block style={{ marginTop: 12 }} onClick={() => void start(next.id)}>Start workout</Button>
            <Button variant="ghost" block style={{ marginTop: 4, height: 40 }} onClick={() => void start(null)}>Start empty workout</Button>
          </Card>
        ) : (
          <Card>
            <EmptyState text="No routines yet. Build one to get pre-filled sets and automatic progression."
              action={<div className="stack-sm"><Button block onClick={() => setStarter(true)}>Use a starter program</Button>
                <Button variant="secondary" block onClick={() => nav('/routines/new')}><Plus size={18} />Create routine</Button>
                <Button variant="ghost" block onClick={() => void start(null)}>Start empty workout</Button></div>} />
          </Card>
        )}
      </div>

      <div className="section">
        <div className="section-label"><span className="micro">This week</span></div>
        <div className="stats">
          <div className="stat"><span className="micro">Sessions</span><span className="num">{cur?.sessions ?? 0}<span className="of">/{stats?.weekly_target ?? 3}</span></span></div>
          <div className="stat">
            <span className="micro">Sets</span><span className="num">{cur?.sets ?? 0}</span>
            {prev && prev.sets > 0 && <Delta value={(cur?.sets ?? 0) - prev.sets} format={(v) => String(v)} />}
          </div>
          <div className="stat">
            <Term k="tonnage" micro>Tonnage</Term><span className="num">{fmtCompact(toDisplay(cur?.tonnage_kg ?? 0) ?? 0)}</span>
            {prev && prev.tonnage_kg > 0 && <Delta value={((cur?.tonnage_kg ?? 0) - prev.tonnage_kg) / prev.tonnage_kg * 100} format={(v) => `${Math.round(v)}%`} />}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-label"><span className="micro">Quick log · today</span></div>
        <div className="quick">
          <button type="button" onClick={() => setLog('bw')}>
            <span className="micro">Weight</span>
            <span className={`num ${bw == null ? 'placeholder' : ''}`}>{bw == null ? '—' : <>{w(bw)}<span className="unit">{units}</span></>}</span>
          </button>
          <button type="button" onClick={() => setLog('food')} aria-label="Log food (calories)">
            <span className="micro">Calories</span>
            <span className={`num ${nutrition?.calories == null ? 'placeholder' : ''}`}>{nutrition?.calories ?? '—'}</span>
          </button>
          <button type="button" onClick={() => setLog('food')} aria-label="Log food (protein)">
            <span className="micro">Protein</span>
            <span className={`num ${nutrition?.protein_g == null ? 'placeholder' : ''}`}>{nutrition?.protein_g ?? '—'}{nutrition?.protein_g != null && <span className="unit">g</span>}</span>
          </button>
        </div>
      </div>

      {prs.length > 0 && (
        <div className="section">
          <div className="section-label"><span className="micro">Recent PRs</span><PrBadge>{`${prs.length}`}</PrBadge></div>
          <div className="list">
            {prs.map((p, i) => (
              <ListRow key={i} title={p.exercise_name} sub={`${PR_LABEL[p.type]} · ${fmtDay(p.achieved_at, { weekday: 'short' })}`} onClick={() => nav(`/exercises/${p.exercise_id}`)}
                value={<span className="num" style={{ fontSize: 20, color: 'var(--pr)' }}>
                  {fmtVolume(p.value, p.load_type, (kg) => toDisplay(kg) ?? 0, units)}
                </span>} />
            ))}
          </div>
        </div>
      )}

      <StarterProgramSheet open={starter} onClose={() => setStarter(false)} />
      <KeypadSheet open={log === 'bw'} title="Bodyweight" subtitle={fmtDay(today)} onClose={() => setLog(null)} nextLabel="Save"
        fields={[{ key: 'v', label: 'Bodyweight', unit: units, decimals: true, value: null, placeholder: toDisplay(bw), step: units === 'lb' ? 0.5 : 0.1 }]}
        onDone={async (v) => {
          setLog(null);
          if (v.v != null && v.v > 0) { await act(db.logBodyweight({ date: today, weight_kg: toKg(v.v)! })); toast('Bodyweight logged', 'success'); }
        }} />
      <LogFoodSheet open={log === 'food'} onClose={() => setLog(null)} date={today} />
    </Screen>
  );
}
