import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { act, useSettings, useUnits } from '../../app/queries';
import { db } from '../../db/client';
import type { Equipment, Sex } from '../../shared/types';
import { KeypadSheet } from '../../ui/Keypad';
import { Button, Field, Segmented, ValueButton } from '../../ui/primitives';

const CAP_EQUIPMENT: { key: Equipment; label: string; hint: string }[] = [
  { key: 'dumbbell', label: 'Heaviest dumbbell', hint: 'Per hand' },
  { key: 'kettlebell', label: 'Heaviest kettlebell', hint: '' },
  { key: 'band', label: 'Strongest band', hint: 'Rated load, if you track it' },
];

export function Onboarding() {
  const nav = useNavigate();
  const s = useSettings().data;
  const { units, toDisplay, toKg } = useUnits();
  const [step, setStep] = useState(0);
  const [sex, setSex] = useState<Sex | 'none'>('none');
  const [birth, setBirth] = useState('');
  const [height, setHeight] = useState<number | null>(null); // display units: in or cm
  const [caps, setCaps] = useState<Partial<Record<Equipment, number>>>({});
  const [kp, setKp] = useState<null | 'height' | Equipment>(null);

  const finish = async (withCaps: boolean) => {
    await act(db.updateSettings({
      sex: sex === 'none' ? null : sex,
      birth_date: birth || null,
      height_cm: height == null ? null : units === 'lb' ? height * 2.54 : height,
      onboarded: true,
    }));
    if (withCaps && Object.keys(caps).length) await act(db.applyEquipmentCaps(caps));
    nav('/', { replace: true });
  };

  return (
    <div className="app">
      <div className="onb">
        <div className="onb-steps">{[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>

        {step === 0 && (
          <div className="grow">
            <div className="wordmark">RED<span>LINE</span></div>
            <p className="muted" style={{ marginTop: 12, marginBottom: 32 }}>Pick a routine, lift what it suggests, tap to log. Next session’s targets are worked out for you.</p>
            <div className="micro" style={{ marginBottom: 8 }}>Units</div>
            <div className="big-choice">
              {(['lb', 'kg'] as const).map((u) => (
                <button key={u} type="button" className={s?.units === u ? 'on' : ''} onClick={() => void act(db.setUnits(u))}>{u}</button>
              ))}
            </div>
            <p className="caption" style={{ marginTop: 12 }}>You can switch any time. Everything is stored precisely either way.</p>
          </div>
        )}

        {step === 1 && (
          <div className="grow">
            <h1 className="title">About you</h1>
            <p className="muted" style={{ margin: '8px 0 24px' }}>Optional. Makes calorie estimates more accurate.</p>
            <Field label="Sex" group>
              <Segmented value={sex} onChange={setSex} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'none', label: 'Skip' }]} />
            </Field>
            <Field label="Birth date"><input type="date" className="input" value={birth} onChange={(e) => setBirth(e.target.value)} /></Field>
            <Field label="Height" group>
              <ValueButton label="Height" value={height} unit={units === 'lb' ? 'in' : 'cm'} placeholder="Not set" onClick={() => setKp('height')} />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="grow">
            <h1 className="title">Your equipment</h1>
            <p className="muted" style={{ margin: '8px 0 24px' }}>Suggestions never go above what you own. When you max out, Redline suggests a harder variation.</p>
            {CAP_EQUIPMENT.map((c) => (
              <Field key={c.key} label={c.label} hint={c.hint || undefined} group>
                <ValueButton label={c.label} value={caps[c.key] != null ? toDisplay(caps[c.key]) : null} unit={units} placeholder="No limit" onClick={() => setKp(c.key)} />
              </Field>
            ))}
          </div>
        )}

        <div className="stack-sm">
          <Button block onClick={() => (step < 2 ? setStep(step + 1) : void finish(true))}>{step < 2 ? 'Continue' : 'Start training'}</Button>
          {step > 0 && <Button variant="ghost" block onClick={() => (step < 2 ? setStep(step + 1) : void finish(false))}>Skip</Button>}
        </div>
      </div>

      <KeypadSheet open={kp != null} title={kp === 'height' ? 'Height' : CAP_EQUIPMENT.find((c) => c.key === kp)?.label} nextLabel="Save" onClose={() => setKp(null)}
        fields={[kp === 'height'
          ? { key: 'v', label: units === 'lb' ? 'Inches (5′10″ = 70)' : 'Centimetres', unit: units === 'lb' ? 'in' : 'cm', value: height, step: 1 }
          : { key: 'v', label: 'Weight', unit: units, decimals: true, value: kp && caps[kp as Equipment] != null ? toDisplay(caps[kp as Equipment]) : null, step: units === 'lb' ? 5 : 2 }]}
        onDone={(v) => {
          if (kp === 'height') setHeight(v.v);
          else if (kp) setCaps((c) => { const n = { ...c }; if (v.v) n[kp] = toKg(v.v)!; else delete n[kp]; return n; });
          setKp(null);
        }} />
    </div>
  );
}
