// Hand-rolled SVG charts. Styling lives in app.css (.chart …) and uses the viz tokens.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface Pt { x: number; y: number; pr?: boolean }

function niceTicks(min: number, max: number, count = 3): number[] {
  if (!isFinite(min) || !isFinite(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * Line chart: primary series (red), optional secondary dashed series, optional raw dots.
 * Tap/drag to inspect a point.
 */
export function LineChart({ points, secondary, raw, height = 160, formatY, onSelect, selected, yPad = 0.08 }: {
  points: Pt[]; secondary?: Pt[]; raw?: Pt[]; height?: number; formatY?: (v: number) => string;
  onSelect?: (i: number | null) => void; selected?: number | null; yPad?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const padR = 36;
  const padT = 8;
  const padB = 8;
  const all = [...points, ...(secondary ?? []), ...(raw ?? [])];
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin0 = Math.min(...ys);
  const yMax0 = Math.max(...ys);
  const pad = (yMax0 - yMin0) * yPad || Math.max(1, Math.abs(yMax0) * 0.05);
  const ticks = niceTicks(yMin0 - pad, yMax0 + pad);
  const yMin = Math.min(yMin0 - pad, ticks[0] ?? Infinity);
  const yMax = Math.max(yMax0 + pad, ticks.at(-1) ?? -Infinity);
  const sx = (x: number) => (xMax === xMin ? (width - padR) / 2 : ((x - xMin) / (xMax - xMin)) * (width - padR - 8) + 4);
  const sy = (y: number) => padT + (1 - (y - yMin) / (yMax - yMin || 1)) * (height - padT - padB);
  const path = (ps: Pt[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');

  const pick = (clientX: number) => {
    if (!onSelect || !ref.current || !points.length) return;
    const left = ref.current.getBoundingClientRect().left;
    const x = clientX - left;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(sx(p.x) - x) < Math.abs(sx(points[best].x) - x)) best = i; });
    onSelect(best);
  };

  if (!points.length && !raw?.length) return <div ref={ref} style={{ height }} />;
  const last = points.at(-1);
  const sel = selected != null ? points[selected] : null;
  return (
    <div ref={ref} style={{ touchAction: onSelect ? 'pan-y' : undefined }}
      onPointerDown={(e) => pick(e.clientX)} onPointerMove={(e) => e.buttons && pick(e.clientX)}>
      <svg className="chart" width={width} height={height} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={0} x2={width - padR + 4} y1={sy(t)} y2={sy(t)} />
            <text x={width} y={sy(t) + 4} textAnchor="end">{formatY ? formatY(t) : t}</text>
          </g>
        ))}
        {raw?.map((p, i) => <circle key={`r${i}`} className="raw" cx={sx(p.x)} cy={sy(p.y)} r={2.5} />)}
        {secondary && secondary.length > 1 && <path className="line2" d={path(secondary)} />}
        {points.length > 1 && <path className="line" d={path(points)} />}
        {points.map((p, i) => p.pr && <circle key={`p${i}`} className="pr-ring" cx={sx(p.x)} cy={sy(p.y)} r={6} />)}
        {sel && <line className="cursor" x1={sx(sel.x)} x2={sx(sel.x)} y1={padT} y2={height - padB} />}
        {sel && <circle className="pt" cx={sx(sel.x)} cy={sy(sel.y)} r={5} />}
        {!sel && last && <circle className="pt" cx={sx(last.x)} cy={sy(last.y)} r={4} />}
      </svg>
    </div>
  );
}

/** Vertical bars, e.g. sessions per week or weekly tonnage. */
export function BarChart({ bars, height = 120, target, formatY }: {
  bars: { label: string; value: number; on?: boolean }[]; height?: number; target?: number; formatY?: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const padB = 18;
  const padR = 32;
  const max = Math.max(1, target ?? 0, ...bars.map((b) => b.value));
  const ticks = niceTicks(0, max, 2);
  const top = Math.max(max, ticks.at(-1) ?? max);
  const bw = (width - padR) / Math.max(1, bars.length);
  const sy = (v: number) => (1 - v / top) * (height - padB - 4) + 4;
  return (
    <div ref={ref}>
      <svg className="chart" width={width} height={height} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={0} x2={width - padR + 4} y1={sy(t)} y2={sy(t)} />
            <text x={width} y={sy(t) + 4} textAnchor="end">{formatY ? formatY(t) : t}</text>
          </g>
        ))}
        {target != null && <line x1={0} x2={width - padR + 4} y1={sy(target)} y2={sy(target)} stroke="var(--text-3)" strokeDasharray="3 3" />}
        {bars.map((b, i) => {
          const h = Math.max(b.value > 0 ? 2 : 0, height - padB - sy(b.value));
          return (
            <g key={i}>
              <rect className={`bar ${b.on ? 'on' : ''}`} x={i * bw + bw * 0.18} width={bw * 0.64} y={height - padB - h} height={h} rx={3} />
              {(bars.length <= 12 || i % 2 === bars.length % 2) && <text x={i * bw + bw / 2} y={height - 4} textAnchor="middle">{b.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Horizontal single-hue bars sorted by value, with a shaded target band. */
export function HBars({ rows, band, max: maxIn }: { rows: { label: string; value: number }[]; band?: { min: number; max: number }; max?: number }) {
  const max = maxIn ?? Math.max(band ? band.max + 2 : 0, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => {
        const inBand = !band || r.value >= band.min;
        return (
          <div className="hbar" key={r.label}>
            <span className="ellipsis">{r.label}</span>
            <span className="track">
              {band && <span className="bandz" style={{ left: `${(band.min / max) * 100}%`, width: `${((band.max - band.min) / max) * 100}%` }} />}
              <span className={`fill ${inBand ? 'in' : ''}`} style={{ width: `${Math.min(100, (r.value / max) * 100)}%` }} />
            </span>
            <span className="num">{Number.isInteger(r.value) ? r.value : r.value.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Calendar heatmap: columns are weeks (Mon–Sun), most recent on the right. */
export function CalendarHeatmap({ days, weeks = 53, level }: { days: Record<string, number>; weeks?: number; level?: (n: number) => number }) {
  const ref = useRef<HTMLDivElement>(null);
  const cells = useMemo(() => {
    const today = new Date();
    const dow = (today.getDay() + 6) % 7;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - (weeks - 1) * 7);
    const out: { key: string; n: number; future: boolean }[] = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ key, n: days[key] ?? 0, future: d > today });
    }
    return out;
  }, [days, weeks]);
  useEffect(() => { if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth; }, [cells]);
  const lv = level ?? ((n: number) => Math.min(4, n === 0 ? 0 : n + 1));
  return (
    <div className="heatmap" ref={ref} role="img" aria-label="Training calendar">
      {cells.map((c) => <i key={c.key} className={`heat-${lv(c.n)}`} style={c.future ? { opacity: 0 } : undefined} title={`${c.key}: ${c.n}`} />)}
    </div>
  );
}

export function Ring({ value, max, size = 96, label, center }: { value: number; max: number; size?: number; label?: ReactNode; center?: ReactNode }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="ring-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--red-500)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 320ms var(--ease-out)' }} />
        {center && <foreignObject x={0} y={0} width={size} height={size}><div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>{center}</div></foreignObject>}
      </svg>
      {label}
    </div>
  );
}

/** Tiny inline trend line for stat tiles. */
export function Sparkline({ values, width = 64, height = 20 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / (max - min || 1)) * (height - 4)).toFixed(1)}`).join('');
  return <svg width={width} height={height} className="chart"><path className="line" d={d} strokeWidth={1.5} /></svg>;
}
