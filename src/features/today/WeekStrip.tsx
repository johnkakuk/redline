import { useRef, useState } from 'react';
import { addDays, fmtDay, localDate, startOfWeek } from '../../shared/time';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
/** Horizontal travel (px) that counts as a swipe. */
const SWIPE = 40;

/**
 * This week's training days, with a swipe back to last week (and no further, and never into the future).
 * State is local, so leaving Today snaps it back to this week.
 */
export function WeekStrip({ trained, onOpenDay }: { trained: Set<string>; onOpenDay: (date: string) => void }) {
  const [page, setPage] = useState<0 | 1>(0); // 0 = this week, 1 = last week
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const moved = useRef(false);
  const today = localDate();
  const monday = startOfWeek();

  const onPointerDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    moved.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!moved.current && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) moved.current = true;
    if (!moved.current) return;
    // Follow the finger, with resistance past the ends (nothing before last week, nothing after this one).
    const toward = page === 0 ? dx > 0 : dx < 0;
    setDrag(toward ? dx : dx / 4);
  };
  const end = () => {
    if (moved.current) {
      if (page === 0 && drag > SWIPE) setPage(1);
      else if (page === 1 && drag < -SWIPE) setPage(0);
    }
    start.current = null;
    setDrag(0);
  };

  const week = (offset: 0 | 1) => {
    const first = addDays(monday, -7 * offset);
    return (
      <div className="week" aria-label={offset === 0 ? 'This week' : 'Last week'} aria-hidden={page !== offset}>
        {DOW.map((d, i) => {
          const date = localDate(addDays(first, i));
          const done = trained.has(date);
          const cls = `day ${done ? 'done' : ''} ${date === today ? 'today' : ''}`;
          const label = fmtDay(date, { weekday: 'long', month: 'short', day: 'numeric' });
          // Every day up to today opens its Day screen; future days are plain status.
          return date <= today
            ? <button key={i} type="button" className={cls} tabIndex={page === offset ? 0 : -1} onClick={() => onOpenDay(date)}
                aria-label={`${label}${date === today ? ' (today)' : ''}: ${done ? 'trained' : 'no workout'}. Open day`}><span>{d}</span><i /></button>
            : <div key={i} className={cls} aria-label={`${label}: upcoming`}><span>{d}</span><i /></div>;
        })}
      </div>
    );
  };

  return (
    <div className="week-viewport" tabIndex={0} aria-roledescription="week strip"
      aria-label={page === 0 ? 'This week. Swipe right or press Left for last week.' : 'Last week. Swipe left or press Right for this week.'}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}
      // A swipe must never also open a day.
      onClickCapture={(e) => { if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; } }}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') setPage(1); if (e.key === 'ArrowRight') setPage(0); }}>
      <div className={`week-track ${drag ? 'dragging' : ''}`} style={{ transform: `translateX(calc(${page === 0 ? '-50%' : '0%'} + ${drag}px))` }}>
        {week(1)}
        {week(0)}
      </div>
    </div>
  );
}
