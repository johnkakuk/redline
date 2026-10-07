import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useUnits } from '../../app/queries';
import { db } from '../../db/client';
import { fmtVolume, PR_LABEL } from '../../engine/prs';
import { addDays, fmtDay } from '../../shared/time';
import { fmtCompact } from '../../shared/units';
import { LineChart } from '../../ui/charts';
import { Term } from '../../ui/InfoTip';
import { Card, Segmented } from '../../ui/primitives';

export type Range = '1M' | '3M' | '6M' | '1Y' | 'All';
export const RANGES: { value: Range; label: string }[] = [
  { value: '1M', label: '1M' }, { value: '3M', label: '3M' }, { value: '6M', label: '6M' }, { value: '1Y', label: '1Y' }, { value: 'All', label: 'All' },
];
export const rangeSince = (r: Range) =>
  r === 'All' ? undefined : addDays(new Date(), -({ '1M': 30, '3M': 91, '6M': 182, '1Y': 365 } as const)[r]).toISOString();

/** e1RM trend + top sets + PR timeline for one exercise. */
export function StrengthPanel({ exerciseId }: { exerciseId: string }) {
  const { w, units, toDisplay } = useUnits();
  const [range, setRange] = useState<Range>('3M');
  const [sel, setSel] = useState<number | null>(null);
  const series = useQuery({ queryKey: ['series', exerciseId, range], queryFn: () => db.strengthSeries(exerciseId, rangeSince(range)) }).data;
  const history = useQuery({ queryKey: ['history', exerciseId], queryFn: () => db.exerciseHistory(exerciseId, 12) }).data ?? [];
  const prs = useQuery({ queryKey: ['prs', exerciseId], queryFn: () => db.recentPrs({ exerciseId, limit: 12 }) }).data ?? [];
  const reps = series?.metric === 'reps';
  const pts = (series?.points ?? []).map((p) => ({ x: Date.parse(p.date), y: reps ? p.value : toDisplay(p.value) ?? 0, pr: p.pr }));
  const shown = sel != null ? series?.points[sel] : series?.points.at(-1);
  const first = series?.points[0];
  const change = shown && first ? shown.value - first.value : 0;

  return (
    <>
      <Card>
        <div className="chart-tip">
          <div>
            {reps ? <div className="micro">Best reps</div> : <Term k="e1rm" micro>Est. 1RM</Term>}
            <div className="num" style={{ fontSize: 34, marginTop: 4 }}>
              {shown ? (reps ? shown.value : w(shown.value)) : '—'}<span className="unit">{reps ? 'reps' : units}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {shown && <div className="caption">{fmtDay(shown.date, { month: 'short', day: 'numeric', year: '2-digit' })}</div>}
            {shown && <div className="caption">{shown.weight_kg != null && !reps ? `${w(shown.weight_kg)} × ${shown.reps}` : ''}</div>}
            {sel == null && first && shown && first !== shown && Math.abs(change) > 1e-9 && (
              <div className={`delta ${change > 0 ? 'up' : 'down'}`}>{change > 0 ? '+' : '−'}{reps ? Math.abs(change) : w(Math.abs(change))} in range</div>
            )}
          </div>
        </div>
        {pts.length ? (
          <LineChart points={pts} height={170} selected={sel} onSelect={setSel} formatY={(v) => fmtCompact(v)} />
        ) : (
          <p className="muted center" style={{ padding: '40px 0' }}>No sessions in this range.</p>
        )}
        <div className="range"><Segmented small value={range} options={RANGES} onChange={(r) => { setRange(r); setSel(null); }} /></div>
      </Card>

      {history.length > 0 && (
        <div className="section">
          <div className="section-label"><span className="micro">Top sets</span></div>
          <div className="list">
            {history.map((h) => (
              <div className="list-row" key={h.workout_id}>
                <div className="lr-main">
                  <div className="lr-title">{fmtDay(h.date, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                  <div className="lr-sub">{h.sets.filter((s) => s.kind === 'working').map((s) => (reps ? s.reps : `${w(s.weight_kg)}×${s.reps}`)).join('  ')}</div>
                </div>
                <div className="lr-value"><span className="num" style={{ fontSize: 20, color: 'var(--text-1)' }}>
                  {h.top ? (reps ? `${h.top.reps}` : `${w(h.top.weight_kg)}×${h.top.reps}`) : '—'}
                </span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {prs.length > 0 && (
        <div className="section">
          <div className="section-label"><span className="micro">PR timeline</span></div>
          <div className="list">
            {prs.map((p, i) => (
              <div className="list-row" key={i}>
                <div className="lr-main"><div className="lr-title">{PR_LABEL[p.type]}</div><div className="lr-sub">{fmtDay(p.achieved_at, { month: 'short', day: 'numeric', year: 'numeric' })}</div></div>
                <div className="lr-value"><span className="num" style={{ fontSize: 20, color: 'var(--pr)' }}>
                  {fmtVolume(p.value, p.load_type, (kg) => toDisplay(kg) ?? 0, units)}
                </span></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
