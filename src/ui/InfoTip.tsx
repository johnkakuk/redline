import { Info } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY, type GlossaryKey } from '../shared/glossary';

/** ⓘ button that explains a term. Tap to toggle; hover with a mouse. */
export function InfoTip({ k }: { k: GlossaryKey }) {
  const { title, body } = GLOSSARY[k];
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // A click pins the tip open; hover (mouse only) just previews it.
  const pinned = useRef(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 32);
    const left = Math.max(16, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 16));
    const h = pop.current?.offsetHeight ?? 120;
    const above = r.bottom + 8 + h > window.innerHeight - 16;
    setPos({ left, top: above ? r.top - 8 - h : r.bottom + 8, above });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (btn.current?.contains(e.target as Node) || pop.current?.contains(e.target as Node)) return;
      pinned.current = false;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { pinned.current = false; setOpen(false); } };
    const onScroll = () => { pinned.current = false; setOpen(false); };
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className="info-btn" aria-label={`What is ${title.toLowerCase()}?`} aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const close = open && pinned.current;
          pinned.current = !close;
          setOpen(!close);
        }}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && !pinned.current && setOpen(false)}>
        <Info size={15} />
      </button>
      {open && createPortal(
        <div ref={pop} className="info-pop" role="tooltip" style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}>
          <div className="info-title">{title}</div>
          <div>{body}</div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Label text followed by an info button. */
export function Term({ children, k, micro }: { children: React.ReactNode; k: GlossaryKey; micro?: boolean }) {
  return (
    <span className={`term ${micro ? 'micro' : ''}`}>
      {children}<InfoTip k={k} />
    </span>
  );
}
