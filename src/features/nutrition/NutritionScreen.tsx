import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { act, useSettings } from '../../app/queries';
import { db } from '../../db/client';
import { addDays, fmtDay, localDate, parseLocalDate } from '../../shared/time';
import type { Meal } from '../../shared/types';
import { BarChart, Ring } from '../../ui/charts';
import { KeypadSheet } from '../../ui/Keypad';
import { Button, Card, Segmented } from '../../ui/primitives';
import { Screen } from '../../ui/Screen';
import { toast } from '../../ui/toast';
import { FoodLogList } from './FoodLogList';
import { dayLabel, LogFoodSheet, macros } from './LogFoodSheet';
import { MealSheet } from './MealSheet';

const TREND_DAYS = 30;

export function NutritionScreen() {
  const settings = useSettings().data;
  const today = localDate();
  const [date, setDate] = useState(today); // local: leaving the tab snaps back to today
  const [log, setLog] = useState(false);
  const [meal, setMeal] = useState<Meal | null | 'new'>(null);
  const [target, setTarget] = useState<null | 'calories' | 'protein'>(null);
  const [trend, setTrend] = useState<'calories' | 'protein'>('calories');

  const totals = useQuery({ queryKey: ['nutrition', date], queryFn: () => db.getNutrition(date) }).data;
  const meals = useQuery({ queryKey: ['meals'], queryFn: () => db.listMeals() }).data ?? [];
  const series = useQuery({ queryKey: ['nutrition', 'series'], queryFn: () => db.listNutrition(localDate(addDays(new Date(), -(TREND_DAYS - 1)))) }).data ?? [];

  const calT = settings?.calorie_target ?? null;
  const proT = settings?.protein_target_g ?? null;
  const cal = totals?.calories ?? 0;
  const pro = totals?.protein_g ?? 0;
  const shift = (n: number) => setDate((d) => { const next = localDate(addDays(parseLocalDate(d), n)); return next > today ? today : next; });

  const bars = Array.from({ length: TREND_DAYS }, (_, i) => {
    const d = localDate(addDays(new Date(), i - (TREND_DAYS - 1)));
    const row = series.find((x) => x.date === d);
    return { label: i % 5 === 4 ? fmtDay(d, { month: 'numeric', day: 'numeric' }) : '', value: (trend === 'calories' ? row?.calories : row?.protein_g) ?? 0, on: d === date };
  });
  // 7-day average over days that have anything logged (an empty day is "not logged", not "ate zero").
  const last7 = series.filter((x) => x.date > localDate(addDays(new Date(), -7)));
  const avg = (k: 'calories' | 'protein_g') => {
    const xs = last7.map((x) => x[k]).filter((v): v is number => v != null);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  const avgCal = avg('calories');
  const avgPro = avg('protein_g');

  const left = (have: number, goal: number | null, unit: string) => {
    if (!goal) return 'No target';
    const diff = Math.round(goal - have);
    return diff >= 0 ? `${diff} ${unit} left` : `${-diff} ${unit} over`;
  };

  return (
    <Screen title="Nutrition" action={
      <button type="button" className="icon-btn" style={{ color: 'var(--red-400)' }} aria-label="Log food" onClick={() => setLog(true)}><Plus size={26} /></button>
    }>
      <div className="day-nav">
        <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => shift(-1)}><ChevronLeft size={20} /></button>
        <button type="button" className="day-nav-label" onClick={() => setDate(today)} aria-label="Go to today">{dayLabel(date)}</button>
        <button type="button" className="icon-btn" aria-label="Next day" disabled={date >= today} style={date >= today ? { opacity: 0.3 } : undefined} onClick={() => shift(1)}><ChevronRight size={20} /></button>
      </div>

      <Card>
        <div className="stats two" style={{ gap: 0 }}>
          <button type="button" className="ring-btn" onClick={() => setTarget('calories')} aria-label={`Calories ${cal}${calT ? ` of ${calT}` : ''}. Set target`}>
            <Ring value={cal} max={calT ?? Math.max(cal, 1)} size={112}
              center={<><span className="num" style={{ fontSize: 28 }}>{Math.round(cal)}</span><span className="caption">{calT ? `/ ${calT}` : 'kcal'}</span></>}
              label={<><span className="micro">Calories</span><span className="caption">{left(cal, calT, 'kcal')}</span></>} />
          </button>
          <button type="button" className="ring-btn" onClick={() => setTarget('protein')} aria-label={`Protein ${pro} g${proT ? ` of ${proT}` : ''}. Set target`}>
            <Ring value={pro} max={proT ?? Math.max(pro, 1)} size={112}
              center={<><span className="num" style={{ fontSize: 28 }}>{Math.round(pro)}<span className="unit">g</span></span><span className="caption">{proT ? `/ ${proT} g` : 'protein'}</span></>}
              label={<><span className="micro">Protein</span><span className="caption">{left(pro, proT, 'g')}</span></>} />
          </button>
        </div>
        {(!calT || !proT) && <p className="caption center" style={{ marginTop: 12 }}>Tap a ring to set your daily target.</p>}
        <Button block style={{ marginTop: 16 }} onClick={() => setLog(true)}><Plus size={18} />Log food</Button>
      </Card>

      <div className="section">
        <div className="section-label"><span className="micro">{date === today ? 'Today’s log' : `Log · ${dayLabel(date)}`}</span></div>
        <FoodLogList date={date} empty={date === today ? 'Nothing logged yet today.' : 'Nothing logged this day.'} />
      </div>

      <Card className="section" label={`Last ${TREND_DAYS} days`} action={
        <div style={{ width: 170 }}><Segmented small value={trend} onChange={setTrend} options={[{ value: 'calories', label: 'kcal' }, { value: 'protein', label: 'Protein' }]} /></div>
      }>
        <BarChart bars={bars} height={130} target={(trend === 'calories' ? calT : proT) ?? undefined}
          formatY={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))} />
        <div className="caption" style={{ marginTop: 8 }}>
          7-day average: {trend === 'calories' ? (avgCal != null ? `${avgCal} kcal` : '—') : (avgPro != null ? `${avgPro} g protein` : '—')}
          {' · '}dashed line is your target
        </div>
      </Card>

      <div className="section">
        <div className="section-label">
          <span className="micro">Saved meals</span>
          <Button variant="ghost" size="sm" onClick={() => setMeal('new')}><Plus size={16} />New meal</Button>
        </div>
        {meals.length ? (
          <div className="list">
            {meals.map((m) => (
              // Edit and one-tap log are sibling buttons (a button can't contain another).
              <div key={m.id} className="list-row" style={{ padding: 0, paddingRight: 4 }}>
                <button type="button" className="list-row grow" onClick={() => setMeal(m)} aria-label={`Edit ${m.name}`}>
                  <div className="lr-main"><div className="lr-title">{m.name}</div><div className="lr-sub">{macros(m.calories, m.protein_g)}</div></div>
                </button>
                <button type="button" className="icon-btn" style={{ color: 'var(--red-400)' }} aria-label={`Log ${m.name}`}
                  onClick={() => void act(db.logFood({ date, meal_id: m.id })).then((id) => id && toast(`Logged ${m.name}`, 'success'))}>
                  <Plus size={20} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="card"><p className="muted">Save meals you eat often, then log them with one tap.</p></div>
        )}
      </div>

      <LogFoodSheet open={log} onClose={() => setLog(false)} date={date} />
      <MealSheet open={meal != null} meal={meal === 'new' ? null : meal} onClose={() => setMeal(null)} />
      <KeypadSheet open={target != null} title={target === 'calories' ? 'Daily calorie target' : 'Daily protein target'} nextLabel="Save" onClose={() => setTarget(null)}
        fields={[target === 'calories'
          ? { key: 'v', label: 'kcal · empty clears', unit: 'kcal', value: calT, step: 50 }
          : { key: 'v', label: 'grams · empty clears', unit: 'g', value: proT, step: 5 }]}
        onDone={(v) => { const k = target; setTarget(null); void act(db.updateSettings(k === 'calories' ? { calorie_target: v.v } : { protein_target_g: v.v })); }} />
    </Screen>
  );
}
