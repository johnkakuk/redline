import { ArrowDown, ArrowUp, Check, ChevronRight, Equal, Lock, Minus, Plus, Sparkles, Star } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LoadType, ProgressionStatus } from '../shared/types';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export function Button({
  variant = 'primary', size, block, className = '', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm'; block?: boolean }) {
  return <button type="button" className={`btn ${variant} ${size ?? ''} ${block ? 'block' : ''} ${className}`} {...rest} />;
}

export function Card({ children, className = '', label, action, onClick }: {
  children?: ReactNode; className?: string; label?: ReactNode; action?: ReactNode; onClick?: () => void;
}) {
  const head = label || action ? (
    <div className="card-head">{typeof label === 'string' ? <span className="micro">{label}</span> : label}{action}</div>
  ) : null;
  if (onClick) {
    return (
      <button type="button" className={`card card-link ${className}`} style={{ width: '100%', textAlign: 'left' }} onClick={onClick}>
        {head}{children}
      </button>
    );
  }
  return <div className={`card ${className}`}>{head}{children}</div>;
}

export type BadgeTone = 'red' | 'success' | 'warning' | 'pr' | 'info' | 'capped' | 'neutral';

export function Badge({ tone = 'neutral', icon, children }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{icon}{children}</span>;
}

/** Progression status: color is always paired with an icon and a word. */
export function StatusBadge({ status, pinned, label, loadType }: {
  status: ProgressionStatus | null | undefined; pinned?: boolean; label?: string; loadType?: LoadType;
}) {
  // Bodyweight exercises have no load to cap; "capped" there just means the rep target was hit.
  if (loadType === 'bodyweight' && (status === 'capped' || status === 'variation_suggested') && !pinned) return null;
  if (pinned) return <Badge tone="neutral" icon={<Lock />}>{label ?? 'Pinned'}</Badge>;
  switch (status) {
    case 'progressing': return <Badge tone="success" icon={<ArrowUp />}>{label ?? 'Progressing'}</Badge>;
    case 'holding': return <Badge tone="warning" icon={<Equal />}>{label ?? 'Hold'}</Badge>;
    case 'deload_suggested': return <Badge tone="warning" icon={<ArrowDown />}>{label ?? 'Deload'}</Badge>;
    case 'capped': return <Badge tone="capped" icon={<Lock />}>{label ?? 'Capped'}</Badge>;
    case 'variation_suggested': return <Badge tone="capped" icon={<Lock />}>{label ?? 'Capped'}</Badge>;
    default: return null;
  }
}

export const PrBadge = ({ children = 'PR' }: { children?: ReactNode }) => <Badge tone="pr" icon={<Star />}>{children}</Badge>;
export const AiBadge = ({ children = 'AI draft' }: { children?: ReactNode }) => <Badge tone="info" icon={<Sparkles />}>{children}</Badge>;

export function Segmented<T extends string>({ value, options, onChange, small }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; small?: boolean;
}) {
  return (
    <div className={`segmented ${small ? 'small' : ''}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ on, children, onClick }: { on?: boolean; children: ReactNode; onClick?: () => void }) {
  return <button type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>{children}</button>;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Stepper({ value, onChange, min = 0, max = 999, step = 1, format, label }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; format?: (v: number) => ReactNode; label: string;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}><Minus size={18} /></button>
      <span className="num">{format ? format(value) : value}</span>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}><Plus size={18} /></button>
    </div>
  );
}

export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return <div className="empty"><p>{text}</p>{action}</div>;
}

export function ListRow({ title, sub, value, onClick, chevron = !!onClick, leading, trailing, selected, className = '' }: {
  title: ReactNode; sub?: ReactNode; value?: ReactNode; onClick?: () => void; chevron?: boolean; leading?: ReactNode; trailing?: ReactNode; selected?: boolean; className?: string;
}) {
  const inner = (
    <>
      {leading}
      <div className="lr-main"><div className="lr-title">{title}</div>{sub != null && <div className="lr-sub">{sub}</div>}</div>
      {value != null && <div className="lr-value">{value}</div>}
      {trailing}
      {chevron && <ChevronRight size={18} className="chev" />}
    </>
  );
  return onClick
    ? <button type="button" className={`list-row ${selected ? 'selected' : ''} ${className}`} onClick={onClick}>{inner}</button>
    : <div className={`list-row ${selected ? 'selected' : ''} ${className}`}>{inner}</div>;
}

/** Labelled form field. Use `group` for non-input controls (segmented, value buttons) so they keep their own names. */
export function Field({ label, hint, children, group }: { label: string; hint?: ReactNode; children: ReactNode; group?: boolean }) {
  const inner = (
    <>
      <span className="micro field-label">{label}</span>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </>
  );
  return group ? <div className="field" role="group" aria-label={label}>{inner}</div> : <label className="field">{inner}</label>;
}

/** A tappable value that opens the keypad instead of the system keyboard. */
export function ValueButton({ value, unit, placeholder = '—', onClick, label }: {
  value: ReactNode | null | undefined; unit?: string; placeholder?: string; onClick: () => void; label: string;
}) {
  const empty = value == null || value === '';
  return (
    <button type="button" className="value-btn" onClick={onClick} aria-label={label}>
      {empty ? <span className="placeholder">{placeholder}</span> : <span><span className="num">{value}</span>{unit && <span className="unit" style={{ fontSize: 15 }}>{unit}</span>}</span>}
      <ChevronRight size={16} className="dim" />
    </button>
  );
}

export function Delta({ value, format, invert }: { value: number; format: (v: number) => string; invert?: boolean }) {
  if (Math.abs(value) < 1e-9) return <span className="delta flat"><Equal size={12} />{format(0)}</span>;
  const up = value > 0;
  const good = invert ? !up : up;
  return <span className={`delta ${good ? 'up' : 'down'}`}>{up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{format(Math.abs(value))}</span>;
}

export const CheckIcon = () => <Check size={20} strokeWidth={3} />;
