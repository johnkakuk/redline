import { Delete, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Segmented } from './primitives';
import { Sheet } from './Sheet';

export interface KeypadField {
  key: string;
  label: string;
  value: number | null;
  /** Shown dimmed when the value is empty; steppers start from here. */
  placeholder?: number | null;
  unit?: string;
  step?: number;
  min?: number;
  max?: number | null;
  /** Hint shown when the value is at the max, e.g. "Max 50 lb". */
  maxHint?: string;
  /** Informational limit: shows a hint at or above it but never blocks input (e.g. equipment caps mid-workout). */
  softMax?: number | null;
  decimals?: boolean;
  /**
   * Optional second way to enter the value, e.g. both dumbbells together. The field's values stay in base
   * units; the alternate view shows and accepts value × factor.
   */
  alt?: { baseLabel: string; altLabel: string; factor: number };
}

const ALT_PREF = 'redline-keypad-alt';
const readAltPref = () => { try { return localStorage.getItem(ALT_PREF) === '1'; } catch { return false; } };
const writeAltPref = (on: boolean) => { try { localStorage.setItem(ALT_PREF, on ? '1' : '0'); } catch { /* per-device convenience */ } };

export type KeypadValues = Record<string, number | null>;

const fmt = (n: number | null | undefined) => (n == null ? '' : String(Math.round(n * 100) / 100));

/**
 * Custom numeric keypad sheet. Replaces the system keyboard for weights and reps.
 * "Next" advances through fields; on the last field it calls onNext (or onDone).
 */
export function KeypadSheet({ open, title, fields, initialField, onDone, onNext, onClose, nextLabel = 'Next', subtitle }: {
  open: boolean; title?: string; subtitle?: string; fields: KeypadField[]; initialField?: string;
  onDone: (v: KeypadValues) => void; onNext?: (v: KeypadValues) => void; onClose: () => void; nextLabel?: string;
}) {
  const [active, setActive] = useState(initialField ?? fields[0]?.key);
  const [text, setText] = useState<Record<string, string>>({});
  const [fresh, setFresh] = useState(true);
  const [altOn, setAltOn] = useState(readAltPref);
  const fieldsKey = fields.map((f) => `${f.key}:${f.value}`).join('|');

  useEffect(() => {
    if (!open) return;
    setActive(initialField ?? fields[0]?.key);
    const alt = readAltPref();
    setAltOn(alt);
    setText(Object.fromEntries(fields.map((f) => [f.key, fmt(f.value != null && f.alt && alt ? f.value * f.alt.factor : f.value)])));
    setFresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialField, fieldsKey]);

  const field = fields.find((f) => f.key === active) ?? fields[0];
  if (!field) return null;
  /** Multiplier between what's shown/typed and the field's base units. */
  const k = (f: KeypadField) => (f.alt && altOn ? f.alt.factor : 1);
  const kf = k(field);
  const raw = text[field.key] ?? '';
  const num = raw === '' || raw === '.' ? null : Number(raw);
  const max = field.max != null ? field.max * kf : null;
  const softMax = field.softMax != null ? field.softMax * kf : null;
  const placeholder = field.placeholder != null ? field.placeholder * kf : null;
  const shownNum = num ?? placeholder ?? null;
  const atMax = max != null && shownNum != null && shownNum >= max - 1e-9;
  const overSoft = softMax != null && shownNum != null && shownNum > softMax + 1e-9;
  const atSoft = softMax != null && shownNum != null && !overSoft && shownNum >= softMax - 1e-9;

  const values = (): KeypadValues =>
    Object.fromEntries(fields.map((f) => {
      const t = text[f.key] ?? '';
      let v = t === '' || t === '.' ? null : Number(t) / k(f);
      if (v != null && f.max != null) v = Math.min(v, f.max);
      if (v != null && f.min != null) v = Math.max(v, f.min);
      return [f.key, v];
    }));

  const set = (s: string) => setText((t) => ({ ...t, [field.key]: s }));

  const press = (k: string) => {
    let cur = fresh ? '' : raw;
    setFresh(false);
    if (k === '.') {
      if (!field.decimals || cur.includes('.')) return;
      cur = cur === '' ? '0.' : cur + '.';
    } else {
      if (cur === '0') cur = '';
      const next = cur + k;
      const [, dec] = next.split('.');
      if (dec && dec.length > 2) return;
      if (next.replace('.', '').length > 5) return;
      cur = next;
    }
    if (max != null && Number(cur) > max) cur = fmt(max);
    set(cur);
  };

  const back = () => { setFresh(false); set(raw.slice(0, -1)); };

  const stepBy = (dir: 1 | -1) => {
    const step = (field.step ?? 1) * kf;
    const base = num ?? placeholder ?? 0;
    // Snap to the step grid, then move.
    let v = dir > 0 ? Math.floor(base / step + 1e-6) * step + step : Math.ceil(base / step - 1e-6) * step - step;
    v = Math.max(field.min ?? 0, v);
    if (max != null) v = Math.min(max, v);
    setFresh(true);
    set(fmt(Math.round(v * 100) / 100));
  };

  const idx = fields.indexOf(field);
  const next = () => {
    if (idx < fields.length - 1) { setActive(fields[idx + 1].key); setFresh(true); return; }
    if (onNext) onNext(values()); else onDone(values());
  };

  const stepLabel = fmt((field.step ?? 1) * kf);

  const switchAlt = (on: boolean) => {
    if (on === altOn || !field.alt) return;
    const factor = field.alt.factor;
    // Convert what's typed so the number keeps meaning the same load.
    setText((t) => Object.fromEntries(Object.entries(t).map(([key, v]) => {
      const f = fields.find((x) => x.key === key);
      if (!f?.alt || v === '' || v === '.') return [key, v];
      return [key, fmt(on ? Number(v) * factor : Number(v) / factor)];
    })));
    setAltOn(on);
    writeAltPref(on);
    setFresh(true);
  };

  return (
    <Sheet
      open={open}
      onClose={() => onDone(values())}
      label={title ?? 'Keypad'}
      title={title && <div><div className="ellipsis">{title}</div>{subtitle && <div className="caption" style={{ fontWeight: 400 }}>{subtitle}</div>}</div>}
      left={<button type="button" className="navbtn" onClick={onClose}>Cancel</button>}
      right={<button type="button" className="navbtn strong" onClick={() => onDone(values())}>Done</button>}
    >
      {fields.length > 1 && (
        <div className="kp-tabs">
          <Segmented value={field.key} options={fields.map((f) => ({ value: f.key, label: f.label }))} onChange={(k) => { setActive(k); setFresh(true); }} />
        </div>
      )}
      {field.alt && (
        <div style={{ margin: '0 auto 8px', width: 220 }}>
          <Segmented small value={altOn ? 'alt' : 'base'} onChange={(v) => switchAlt(v === 'alt')}
            options={[{ value: 'base', label: field.alt.baseLabel }, { value: 'alt', label: field.alt.altLabel }]} />
        </div>
      )}
      <div className="kp-display">
        <button type="button" className="kp-step" onClick={() => stepBy(-1)} aria-label={`Minus ${stepLabel}`}>−{stepLabel}</button>
        <div className={`kp-value ${raw === '' ? 'placeholder' : ''}`} aria-live="polite">
          {raw === '' ? fmt(placeholder) || '0' : raw}
          {field.unit && <span className="unit">{field.unit}</span>}
        </div>
        <button type="button" className="kp-step" onClick={() => stepBy(1)} disabled={atMax} aria-label={`Plus ${stepLabel}`}>+{stepLabel}</button>
      </div>
      <div className="kp-hint">
        {atMax && field.maxHint ? <><Lock size={13} />{field.maxHint}</>
          : overSoft ? <><Lock size={13} />Above your {fmt(softMax)} {field.unit} max. Fine for today; suggestions stay at your max.</>
          : atSoft ? <><Lock size={13} />At your {fmt(softMax)} {field.unit} max</>
          : field.alt && altOn && shownNum != null ? `= ${fmt(shownNum / field.alt.factor)} ${field.unit} each`
          : fields.length === 1 ? field.label : ''}
      </div>
      <div className="kp-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} type="button" className="kp-key" onClick={() => press(k)}>{k}</button>
        ))}
        {field.decimals
          ? <button type="button" className="kp-key" onClick={() => press('.')}>.</button>
          : <button type="button" className="kp-key" onClick={back} aria-label="Delete"><Delete size={24} /></button>}
        <button type="button" className="kp-key" onClick={() => press('0')}>0</button>
        <button type="button" className="kp-key next" onClick={next}>{idx < fields.length - 1 ? 'Next' : nextLabel}</button>
      </div>
      {field.decimals && (
        <button type="button" className="btn ghost block" style={{ marginTop: 8, height: 40 }} onClick={back} aria-label="Delete">
          <Delete size={18} /> Delete
        </button>
      )}
    </Sheet>
  );
}
