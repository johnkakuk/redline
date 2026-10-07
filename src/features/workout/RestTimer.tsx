import { Timer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fmtDuration } from '../../shared/time';
import { Sheet } from '../../ui/Sheet';
import { beep, useRemaining, useRest } from './restStore';

/**
 * Collapsed bar + expandable sheet. Completion = flash + audio cue; last 3 seconds pulse. Once rest runs out it
 * keeps counting up in red ("+0:12") until the next set starts or it's dismissed.
 */
export function RestTimer() {
  const { expanded, setExpanded, add, skip, label } = useRest();
  const { remaining, over, endsAt, duration } = useRemaining();
  const [flash, setFlash] = useState(false);
  const firedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!endsAt || remaining > 0 || firedFor.current === endsAt) return;
    firedFor.current = endsAt;
    // Only cue if we were here for the end (not when reopening long after).
    if (Date.now() - endsAt < 5000) {
      beep();
      setFlash(true);
      setTimeout(() => setFlash(false), 700);
    }
  }, [remaining, endsAt]);

  if (!endsAt) return flash ? <div className="flash" /> : null;
  const done = remaining <= 0;
  const shown = done ? `+${fmtDuration(over)}` : fmtDuration(remaining);
  const pct = duration > 0 ? 1 - remaining / duration : 1;
  const last3 = remaining > 0 && remaining <= 3;
  const size = 220;
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;

  return (
    <>
      {flash && <div className="flash" />}
      {!expanded && (
        <div className={`rest-bar ${done ? 'done over' : ''}`} role="timer">
          <button type="button" className="row grow" style={{ height: '100%', gap: 12 }} onClick={() => setExpanded(true)} aria-label="Expand rest timer">
            <Timer size={20} color={done ? 'currentColor' : 'var(--red-400)'} />
            <span className="micro grow ellipsis" style={{ textAlign: 'left' }}>{done ? 'Over rest' : `Rest${label ? ` · ${label}` : ''}`}</span>
            <span className={`num ${last3 ? 'pulse' : ''}`} key={last3 ? remaining : 'n'}>{shown}</span>
          </button>
          <button type="button" className="btn ghost sm" onClick={skip}>{done ? 'Dismiss' : 'Skip'}</button>
          <span className="progress" style={{ width: `${pct * 100}%` }} />
        </div>
      )}
      <Sheet open={expanded} onClose={() => setExpanded(false)} title="Rest" label="Rest timer"
        right={<button type="button" className="navbtn" onClick={() => setExpanded(false)}>Hide</button>}>
        <svg className="rest-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-3)" strokeWidth={14} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--red-500)" strokeWidth={14} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={done ? 0 : c * pct} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 250ms linear' }} />
          <text x={size / 2} y={size / 2 + 20} textAnchor="middle" fontSize={56} className={last3 ? 'pulse' : ''}
            style={{ transformOrigin: 'center', fill: done ? 'var(--red-400)' : undefined }}>
            {shown}
          </text>
          {done && <text x={size / 2} y={size / 2 + 52} textAnchor="middle" fontSize={13} style={{ fill: 'var(--text-2)', fontFamily: 'var(--font-ui)', fontWeight: 600, letterSpacing: '0.08em' }}>OVER REST</text>}
        </svg>
        <div className="btn-row">
          <button type="button" className="btn secondary" onClick={() => add(-15)}>−15</button>
          <button type="button" className="btn secondary" onClick={skip}>Skip</button>
          <button type="button" className="btn secondary" onClick={() => add(15)}>+15</button>
        </div>
        <p className="caption center" style={{ marginTop: 12 }}>Keep the app open for the timer alert.</p>
      </Sheet>
    </>
  );
}
