import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveWorkoutId } from '../app/queries';

/** Tab screen with a large title that collapses to a compact bar on scroll. */
export function Screen({ title, eyebrow, action, children }: { title: string; eyebrow?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);
  const active = useActiveWorkoutId();
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { rootMargin: '-40px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className={`screen ${active ? 'has-pill' : ''}`}>
      <div className={`topbar ${compact ? 'show' : ''}`} aria-hidden={!compact}>
        <span className="tb-left" />
        <span>{title}</span>
        <span className="tb-right">{action}</span>
      </div>
      <header className="screen-head">
        {eyebrow && <div className="micro">{eyebrow}</div>}
        <div className="screen-head-row">
          <h1 className="title" ref={titleRef}>{title}</h1>
          {action}
        </div>
      </header>
      {children}
    </div>
  );
}

/** Pushed screen with a back button. */
export function PushScreen({ title, back = true, backLabel = 'Back', right, children, noTabs }: {
  title?: ReactNode; back?: boolean | (() => void); backLabel?: string; right?: ReactNode; children: ReactNode; noTabs?: boolean;
}) {
  const nav = useNavigate();
  const active = useActiveWorkoutId();
  return (
    <div className={`screen ${noTabs ? 'no-tabs' : active ? 'has-pill' : ''}`}>
      <div className="navbar">
        <div className="nb-left">
          {back && (
            <button type="button" className="navbtn" onClick={() => (typeof back === 'function' ? back() : nav(-1))}>
              <ChevronLeft size={22} />{backLabel}
            </button>
          )}
        </div>
        <div className="nb-title ellipsis">{title}</div>
        <div className="nb-right">{right}</div>
      </div>
      {children}
    </div>
  );
}
