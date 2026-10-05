import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { act, useSettings, useUnits } from '../../app/queries';
import { db } from '../../db/client';
import { addDays, fmtDay, localDate, parseLocalDate } from '../../shared/time';
import type { BodyWeightEntry } from '../../shared/types';
import { BarChart, LineChart, Ring } from '../../ui/charts';
import { KeypadSheet } from '../../ui/Keypad';
import { Card, EmptyState, ListRow, Segmented } from '../../ui/primitives';
import { Screen } from '../../ui/Screen';
import { ActionSheet } from '../../ui/Sheet';
import { RANGES, type Range } from '../progress/StrengthPanel';

/** Daily latest weight, then a trailing 7-day mean. */
export function movingAverage(entries: BodyWeightEntry[]) {
  const daily = new Map<string, number>();
  for (const e of entries) daily.set(e.date, e.weight_kg);
  const days = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b));
  return days.map(([date], i) => {
    const t = parseLocalDate(date).getTime();
    const win = days.slice(0, i + 1).filter(([d]) => t - parseLocalDate(d).getTime() < 7 * 86400000);
    return { date, value: win.reduce((a, [, v]) => a + v, 0) / win.length };
  });
}

const rangeDays: Record<Range, number | null> = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365, All: null };

export function BodyScreen() {
  const { w, units, toDisplay, toKg } = useUnits();
  const settings = useSettings().data;
  const [range, setRange] = useState<Range>('3M');
  const [sel, setSel] = useState<number | null>(null);
  const [nutriView, setNutriView] = useState<'calories' | 'protein'>('calories');
  const [edit, setEdit] = useState<null | { entry?: BodyWeightEntry }>(null);
  const [menuFor, setMenuFor] = useState<BodyWeightEntry | null>(null);
  const [logN, setLogN] = useState<null | 'calories' | 'protein'>(null);
  const today = localDate();
  const since = rangeDays[range] ? localDate(addDays(new Date(), -rangeDays[range]!)) : undefined;
  const all = useQuery({ queryKey: ['bodyweight', 'all'], queryFn: () => db.listBodyweight() }).data ?? [];
  const nutrition = useQuery({ queryKey: ['nutrition', 'last30'], queryFn: () => db.listNutrition(localDate(addDays(new Date(), -29))) }).data ?? [];

  const ma = useMemo(() => movingAverage(all), [all]);
  const inRange = (d: string) => !since || d >= since;
  const raw = all.filter((e) => inRange(e.date));
  const maR = ma.filter((p) => inRange(p.date));
  const pts = maR.map((p) => ({ x: parseLocalDate(p.date).getTime(), y: toDisplay(p.value) ?? 0 }));
  const shown = sel != null ? maR[sel] : maR.at(-1);
  const change = maR.length > 1 ? maR.at(-1)!.value - maR[0].value : 0;
  const todayN = nutrition.find((n) => n.date === today);

  const nutriBars = Array.from({ length: 30 }, (_, i) => {
    const d = localDate(addDays(new Date(), i - 29));
    const n = nutrition.find((x) => x.date === d);
    return { label: i % 5 === 4 ? fmtDay(d, { month: 'numeric', day: 'numeric' }) : '', value: (nutriView === 'calories' ? n?.calories : n?.protein_g) ?? 0, on: d === today };
  });

  return (
    <Screen title="Body" action={
      <button type="button" className="icon-btn" style={{ color: 'var(--red-400)' }} aria-label="Log bodyweight" onClick={() => setEdit({})}><Plus size={26} /></button>
    }>
      <Card>
        <div className="chart-tip">
          <div>
            <div className="micro">{sel != null ? '7-day average' : 'Bodyweight · 7-day avg'}</div>
            <div className="num" style={{ fontSize: 34, marginTop: 4 }}>{shown ? <>{w(shown.value)}<span className="unit">{units}</span></> : '—'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {shown && <div className="caption">{fmtDay(shown.date, { month: 'short', day: 'numeric' })}</div>}
            {sel == null && maR.length > 1 && (
              <div className="delta flat" style={{ color: 'var(--text-2)' }}>{change >= 0 ? '+' : '−'}{w(Math.abs(change))} {units} in range</div>
            )}
          </div>
        </div>
        {pts.length ? (
          <LineChart points={pts} raw={raw.map((e) => ({ x: parseLocalDate(e.date).getTime(), y: toDisplay(e.weight_kg) ?? 0 }))} height={170}
            selected={sel} onSelect={setSel} formatY={(v) => String(Math.round(v))} yPad={0.3} />
        ) : (
          <EmptyState text="Log your bodyweight to see the trend." />
        )}
        <div className="range"><Segmented small value={range} options={RANGES} onChange={(r) => { setRange(r); setSel(null); }} /></div>
      </Card>

      <div className="section">
        <div className="section-label"><span className="micro">Nutrition · today</span></div>
        <div className="stats two">
          <button type="button" className="stat" onClick={() => setLogN('calories')} style={{ textAlign: 'center' }}>
            <Ring value={todayN?.calories ?? 0} max={settings?.calorie_target ?? 2500} size={104}
              center={<><span className="num" style={{ fontSize: 26 }}>{todayN?.calories ?? '—'}</span><span className="caption">/ {settings?.calorie_target ?? '—'}</span></>}
              label={<span className="micro">Calories</span>} />
          </button>
          <button type="button" className="stat" onClick={() => setLogN('protein')} style={{ textAlign: 'center' }}>
            <Ring value={todayN?.protein_g ?? 0} max={settings?.protein_target_g ?? 150} size={104}
              center={<><span className="num" style={{ fontSize: 26 }}>{todayN?.protein_g ?? '—'}{todayN?.protein_g != null && <span className="unit">g</span>}</span><span className="caption">/ {settings?.protein_target_g ?? '—'}</span></>}
              label={<span className="micro">Protein</span>} />
          </button>
        </div>
        {(!settings?.calorie_target || !settings?.protein_target_g) && <div className="caption" style={{ marginTop: 8 }}>Set daily targets in Settings.</div>}
      </div>

      <Card className="section" label="Last 30 days" action={
        <div style={{ width: 170 }}><Segmented small value={nutriView} onChange={setNutriView} options={[{ value: 'calories', label: 'kcal' }, { value: 'protein', label: 'Protein' }]} /></div>
      }>
        <BarChart bars={nutriBars} height={120} target={(nutriView === 'calories' ? settings?.calorie_target : settings?.protein_target_g) ?? undefined}
          formatY={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))} />
      </Card>

      {all.length > 0 && (
        <div className="section">
          <div className="section-label"><span className="micro">Log</span></div>
          <div className="list">
            {[...all].reverse().slice(0, 60).map((e) => (
              <ListRow key={e.id} title={<span className="num" style={{ fontSize: 22 }}>{w(e.weight_kg)}<span className="unit">{units}</span></span>}
                sub={fmtDay(e.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + (e.note ? ` · ${e.note}` : '')}
                onClick={() => setMenuFor(e)} chevron={false} />
            ))}
          </div>
        </div>
      )}

      <ActionSheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor ? `${w(menuFor.weight_kg, true)} · ${fmtDay(menuFor.date)}` : ''} actions={[
        { label: 'Edit', icon: <Pencil size={20} />, onSelect: () => setEdit({ entry: menuFor! }) },
        { label: 'Delete', icon: <Trash2 size={20} />, danger: true, onSelect: () => void act(db.deleteBodyweight(menuFor!.id)) },
      ]} />

      <BodyweightSheet edit={edit} onClose={() => setEdit(null)} units={units} toDisplay={toDisplay} toKg={toKg} latest={all.at(-1)?.weight_kg ?? null} />

      <KeypadSheet open={logN != null} title={logN === 'calories' ? 'Calories today' : 'Protein today'} nextLabel="Save" onClose={() => setLogN(null)}
        fields={[logN === 'calories'
          ? { key: 'v', label: 'kcal', unit: 'kcal', value: todayN?.calories ?? null, step: 100 }
          : { key: 'v', label: 'grams', unit: 'g', value: todayN?.protein_g ?? null, step: 10 }]}
        onDone={async (v) => { const k = logN; setLogN(null); await act(db.upsertNutrition(today, k === 'calories' ? { calories: v.v } : { protein_g: v.v })); }} />
    </Screen>
  );
}

function BodyweightSheet({ edit, onClose, units, toDisplay, toKg, latest }: {
  edit: null | { entry?: BodyWeightEntry }; onClose: () => void; units: string; latest: number | null;
  toDisplay: (kg: number | null | undefined) => number | null; toKg: (v: number | null | undefined) => number | null;
}) {
  const [date, setDate] = useState(localDate());
  const e = edit?.entry;
  return (
    <>
      <KeypadSheet open={!!edit} title={e ? 'Edit bodyweight' : 'Log bodyweight'} subtitle={fmtDay(e?.date ?? date)} nextLabel="Save" onClose={onClose}
        fields={[{ key: 'v', label: 'Bodyweight', unit: units, decimals: true, value: toDisplay(e?.weight_kg), placeholder: toDisplay(latest), step: units === 'lb' ? 0.5 : 0.1 }]}
        onDone={async (v) => {
          onClose();
          if (v.v == null || v.v <= 0) return;
          if (e) await act(db.updateBodyweight(e.id, { date: e.date, weight_kg: toKg(v.v)!, note: e.note }));
          else await act(db.logBodyweight({ date, weight_kg: toKg(v.v)! }));
          setDate(localDate());
        }} />
    </>
  );
}
