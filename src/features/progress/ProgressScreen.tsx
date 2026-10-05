import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Lock, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUnits } from '../../app/queries';
import { db } from '../../db/client';
import { VOLUME_BAND } from '../../engine/volume';
import { MUSCLE_LABEL } from '../../shared/labels';
import { addDays, fmtDay, fmtMinutes, localDate, parseLocalDate, startOfWeek } from '../../shared/time';
import { fmtCompact } from '../../shared/units';
import { BarChart, CalendarHeatmap, HBars } from '../../ui/charts';
import { Card, Chip, EmptyState, ListRow, Segmented } from '../../ui/primitives';
import { Screen } from '../../ui/Screen';
import { StrengthPanel } from './StrengthPanel';

type Tab = 'strength' | 'volume' | 'consistency';

export function ProgressScreen() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'strength';
  return (
    <Screen title="Progress">
      <Segmented value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })}
        options={[{ value: 'strength', label: 'Strength' }, { value: 'volume', label: 'Volume' }, { value: 'consistency', label: 'Consistency' }]} />
      <div style={{ marginTop: 16 }}>
        {tab === 'strength' && <Strength />}
        {tab === 'volume' && <Volume />}
        {tab === 'consistency' && <Consistency />}
      </div>
    </Screen>
  );
}

// Favorites are a per-device convenience.
const FAV_KEY = 'redline-fav-lifts';
const readFavs = (): string[] => { try { return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]'); } catch { return []; } };
const writeFavs = (v: string[]) => { try { localStorage.setItem(FAV_KEY, JSON.stringify(v)); } catch { /* ignore */ } };

function Strength() {
  const lifts = useQuery({ queryKey: ['lifts'], queryFn: () => db.strengthLifts() }).data;
  const [favs, setFavs] = useState<string[]>(readFavs);
  const [sel, setSel] = useState<string | null>(null);
  const nav = useNavigate();
  const sorted = [...(lifts ?? [])].sort((a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id)));
  useEffect(() => { if (!sel && sorted.length) setSel(sorted[0].id); }, [sel, sorted]);
  if (!lifts) return null;
  if (!lifts.length) return <EmptyState text="Finish a workout to see strength trends." />;
  const cur = lifts.find((l) => l.id === sel);
  const toggleFav = (id: string) => { const n = favs.includes(id) ? favs.filter((x) => x !== id) : [id, ...favs]; setFavs(n); writeFavs(n); };
  return (
    <>
      <div className="chips">
        {sorted.map((l) => (
          <Chip key={l.id} on={l.id === sel} onClick={() => setSel(l.id)}>
            {favs.includes(l.id) && <Star size={12} fill="currentColor" />}{l.capped && <Lock size={12} />}{l.name}
          </Chip>
        ))}
      </div>
      {cur && (
        <div style={{ marginTop: 12 }}>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <button type="button" className="heading ellipsis" style={{ textAlign: 'left' }} onClick={() => nav(`/exercises/${cur.id}`)}>{cur.name}</button>
            <div className="row">
              {cur.capped && <span className="badge capped"><Lock />Capped</span>}
              <button type="button" className="icon-btn" aria-label={favs.includes(cur.id) ? 'Unfavorite' : 'Favorite'} onClick={() => toggleFav(cur.id)}>
                <Star size={20} fill={favs.includes(cur.id) ? 'var(--pr)' : 'none'} color={favs.includes(cur.id) ? 'var(--pr)' : undefined} />
              </button>
            </div>
          </div>
          <StrengthPanel exerciseId={cur.id} />
        </div>
      )}
    </>
  );
}

function Volume() {
  const { units, toDisplay } = useUnits();
  const [week, setWeek] = useState(localDate(startOfWeek()));
  const thisWeek = localDate(startOfWeek());
  const vol = useQuery({ queryKey: ['volume', week], queryFn: () => db.volumeByMuscle(week) }).data ?? [];
  const trend = useQuery({ queryKey: ['weeklyTrend', 12], queryFn: () => db.weeklyTrend(12) }).data ?? [];
  const heat = useQuery({ queryKey: ['muscleWeeks', 4], queryFn: () => db.muscleWeeks(4) }).data;
  const shift = (n: number) => setWeek(localDate(addDays(parseLocalDate(week), 7 * n)));
  const last = trend.at(-1);
  const prev = trend.at(-2);
  const heatLevel = (v: number) => (v <= 0 ? 0 : v < 5 ? 1 : v < 10 ? 2 : v <= 20 ? 3 : 4);

  return (
    <>
      <Card>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => shift(-1)}><ChevronLeft size={20} /></button>
          <div className="center">
            <div className="micro">Sets per muscle</div>
            <div className="callout">{week === thisWeek ? 'This week' : `Week of ${fmtDay(week)}`}</div>
          </div>
          <button type="button" className="icon-btn" aria-label="Next week" disabled={week >= thisWeek} onClick={() => shift(1)} style={week >= thisWeek ? { opacity: 0.3 } : undefined}><ChevronRight size={20} /></button>
        </div>
        {vol.length ? <HBars rows={vol.map((v) => ({ label: MUSCLE_LABEL[v.muscle], value: v.sets }))} band={VOLUME_BAND} />
          : <p className="muted center" style={{ padding: 24 }}>No working sets this week.</p>}
        <div className="caption" style={{ marginTop: 12 }}>Shaded band: {VOLUME_BAND.min}–{VOLUME_BAND.max} sets. Secondary muscles count half.</div>
      </Card>

      <Card className="section" label="Weekly tonnage" action={last && prev && prev.tonnage_kg > 0 && (
        <span className={`delta ${last.tonnage_kg >= prev.tonnage_kg ? 'up' : 'down'}`}>{last.tonnage_kg >= prev.tonnage_kg ? '↑' : '↓'} {Math.abs(Math.round((last.tonnage_kg / prev.tonnage_kg - 1) * 100))}% vs last week</span>
      )}>
        <div className="num" style={{ fontSize: 34, marginBottom: 8 }}>{fmtCompact(toDisplay(last?.tonnage_kg ?? 0) ?? 0)}<span className="unit">{units}</span></div>
        <BarChart bars={trend.map((t, i) => ({ label: fmtDay(t.week, { month: 'numeric', day: 'numeric' }), value: toDisplay(t.tonnage_kg) ?? 0, on: i === trend.length - 1 }))} formatY={fmtCompact} />
      </Card>

      {heat && heat.rows.length > 0 && (
        <Card className="section" label="Last 4 weeks">
          <div className="muscle-heat" style={{ marginBottom: 6 }}>
            <span />{heat.weeks.map((w) => <span key={w} className="micro center">{fmtDay(w, { month: 'numeric', day: 'numeric' })}</span>)}
          </div>
          {heat.rows.map((r) => (
            <div className="muscle-heat" key={r.muscle} style={{ marginTop: 3 }}>
              <span className="ellipsis">{MUSCLE_LABEL[r.muscle]}</span>
              {r.values.map((v, i) => <i key={i} className={`heat-${heatLevel(v)}`}>{v ? (Number.isInteger(v) ? v : v.toFixed(1)) : ''}</i>)}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function Consistency() {
  const nav = useNavigate();
  const { toDisplay } = useUnits();
  const c = useQuery({ queryKey: ['consistency'], queryFn: () => db.consistency() }).data;
  const trend = useQuery({ queryKey: ['weeklyTrend', 12], queryFn: () => db.weeklyTrend(12) }).data ?? [];
  const history = useQuery({ queryKey: ['workouts'], queryFn: () => db.listWorkouts({ limit: 30 }) }).data ?? [];
  if (!c) return null;
  return (
    <>
      <div className="stats">
        <div className="stat"><span className="micro">Streak</span><span className="num">{c.current_streak}<span className="of"> wk</span></span></div>
        <div className="stat"><span className="micro">Best</span><span className="num">{c.best_streak}<span className="of"> wk</span></span></div>
        <div className="stat"><span className="micro">Avg time</span><span className="num">{c.avg_duration_sec ? fmtMinutes(c.avg_duration_sec) : '—'}</span></div>
      </div>
      <div className="caption" style={{ marginTop: 8 }}>A streak week has {c.weekly_target}+ sessions. Change the target in Settings.</div>

      <Card className="section" label="Last 12 months" action={<span className="caption">{c.total_sessions} {c.total_sessions === 1 ? 'session' : 'sessions'}</span>}>
        <CalendarHeatmap days={c.days} level={(n) => (n === 0 ? 0 : Math.min(4, n + 2))} />
        <div className="heat-legend" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          Less <i className="heat-0" /><i className="heat-1" /><i className="heat-2" /><i className="heat-3" /><i className="heat-4" /> More
        </div>
      </Card>

      <Card className="section" label="Sessions per week">
        <BarChart bars={trend.map((t, i) => ({ label: fmtDay(t.week, { month: 'numeric', day: 'numeric' }), value: t.sessions, on: t.sessions >= c.weekly_target || i === trend.length - 1 }))} target={c.weekly_target} />
      </Card>

      {history.length > 0 && (
        <div className="section">
          <div className="section-label"><span className="micro">History</span></div>
          <div className="list">
            {history.map((h) => (
              <ListRow key={h.id} title={h.name} onClick={() => nav(`/history/${h.id}`)}
                sub={`${fmtDay(h.started_at, { weekday: 'short', month: 'short', day: 'numeric' })} · ${h.sets} sets · ${fmtMinutes(h.active_duration_sec ?? 0)} · ${fmtCompact(toDisplay(h.tonnage_kg) ?? 0)}`} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
