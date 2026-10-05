import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Sheet({ open, onClose, title, left, right, children, full, label }: {
  open: boolean; onClose: () => void; title?: ReactNode; left?: ReactNode; right?: ReactNode; children: ReactNode; full?: boolean; label?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  const head = title != null || left || right;
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className={`sheet ${full ? 'full' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
        <div className="sheet-grip" />
        {head && (
          <div className="sheet-head">
            <div className="sh-left">{left}</div>
            <div className="sh-title">{title}</div>
            <div className="sh-right">{right}</div>
          </div>
        )}
        {full ? <div className="sheet-body">{children}</div> : children}
      </div>
    </>,
    document.body,
  );
}

export interface MenuAction { label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void; hidden?: boolean }

/** iOS-style action sheet. */
export function ActionSheet({ open, onClose, title, actions }: { open: boolean; onClose: () => void; title?: string; actions: MenuAction[] }) {
  return (
    <Sheet open={open} onClose={onClose} label={title ?? 'Actions'}>
      {title && <div className="caption center" style={{ margin: '4px 0 12px' }}>{title}</div>}
      <div className="menu">
        {actions.filter((a) => !a.hidden).map((a) => (
          <button key={a.label} type="button" className={a.danger ? 'danger' : ''} onClick={() => { onClose(); a.onSelect(); }}>
            {a.icon}{a.label}
          </button>
        ))}
      </div>
      <div className="menu" style={{ marginTop: 8 }}>
        <button type="button" onClick={onClose} style={{ justifyContent: 'center', fontWeight: 600 }}>Cancel</button>
      </div>
    </Sheet>
  );
}

export function ConfirmSheet({ open, onClose, title, body, confirmLabel, onConfirm, destructive }: {
  open: boolean; onClose: () => void; title: string; body?: ReactNode; confirmLabel: string; onConfirm: () => void; destructive?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <div className="heading" style={{ marginTop: 8 }}>{title}</div>
      {body && <div className="muted callout" style={{ marginTop: 6 }}>{body}</div>}
      <div className="btn-row" style={{ marginTop: 20 }}>
        <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
        <button type="button" className={`btn ${destructive ? 'destructive' : 'primary'}`} onClick={() => { onClose(); onConfirm(); }}>{confirmLabel}</button>
      </div>
    </Sheet>
  );
}
