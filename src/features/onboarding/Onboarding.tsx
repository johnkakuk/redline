import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { act, useSettings, useUnits } from '../../app/queries';
import { db } from '../../db/client';
import type { ProgramKind } from '../../db/repos/programs.repo';
import type { Sex } from '../../shared/types';
import { KeypadSheet } from '../../ui/Keypad';
import { Button, Field, Segmented, ValueButton } from '../../ui/primitives';
import { EquipmentEditor, ProgramPreview, type EquipmentValue } from './equipment';

const STEPS = 4;

export function Onboarding() {
  const nav = useNavigate();
  const s = useSettings().data;
  const { units } = useUnits();
  const [step, setStep] = useState(0);
  const [sex, setSex] = useState<Sex | 'none'>('none');
  const [birth, setBirth] = useState('');
  const [height, setHeight] = useState<number | null>(null); // display units: in or cm
  const [equipment, setEquipment] = useState<EquipmentValue>({ owned: [], caps: {} });
  const [program, setProgram] = useState<ProgramKind | 'none'>('equipment');
  const [kp, setKp] = useState(false);
  const onlyBw = equipment.owned.every((e) => e === 'pull_up_bar');

  const saveEquipment = async () => {
    await act(db.setEquipment(equipment.owned, equipment.caps));
  };

  const finish = async () => {
    await act(db.updateSettings({
      sex: sex === 'none' ? null : sex,
      birth_date: birth || null,
      height_cm: height == null ? null : units === 'lb' ? height * 2.54 : height,
    }));
    if (program !== 'none') await act(db.createStarterProgram(onlyBw ? 'bodyweight' : program));
    await act(db.updateSettings({ onboarded: true }));
    nav('/', { replace: true });
  };

  const next = async () => {
    if (step === 2) await saveEquipment();
    if (step < STEPS - 1) setStep(step + 1);
    else await finish();
  };

  return (
    <div className="app">
      <div className="onb">
        <div className="onb-steps">{Array.from({ length: STEPS }, (_, i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>

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
            <p className="caption" style={{ marginTop: 24 }}>Have an invite? <button type="button" className="red" onClick={() => nav('/login')}>Log in</button> to restore your data.</p>
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
              <ValueButton label="Height" value={height} unit={units === 'lb' ? 'in' : 'cm'} placeholder="Not set" onClick={() => setKp(true)} />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="grow">
            <h1 className="title">Your equipment</h1>
            <p className="muted" style={{ margin: '8px 0 20px' }}>Workouts only use what you have. Set your heaviest weights and suggestions never go past them.</p>
            <EquipmentEditor value={equipment} onChange={setEquipment} />
          </div>
        )}

        {step === 3 && (
          <div className="grow">
            <h1 className="title">Starter program</h1>
            <p className="muted" style={{ margin: '8px 0 20px' }}>
              {onlyBw ? 'No equipment needed. Every exercise has a harder version to move to as you get stronger.' : 'Three full-body days built from your equipment.'}
            </p>
            <Segmented value={onlyBw && program === 'equipment' ? 'bodyweight' : program} onChange={setProgram}
              options={onlyBw
                ? [{ value: 'bodyweight', label: 'Bodyweight' }, { value: 'none', label: 'Build my own' }]
                : [{ value: 'equipment', label: 'My equipment' }, { value: 'bodyweight', label: 'Bodyweight' }, { value: 'none', label: 'Build my own' }]} />
            <div style={{ marginTop: 16 }}>
              {program === 'none'
                ? <p className="caption">You can add a starter program later from Routines or Settings.</p>
                : <ProgramPreview kind={onlyBw ? 'bodyweight' : program} />}
            </div>
          </div>
        )}

        <div className="stack-sm" style={{ marginTop: 24 }}>
          <Button block onClick={() => void next()}>{step < STEPS - 1 ? 'Continue' : 'Start training'}</Button>
          {step === 1 && <Button variant="ghost" block onClick={() => setStep(2)}>Skip</Button>}
          {step > 0 && <Button variant="ghost" block onClick={() => setStep(step - 1)}>Back</Button>}
        </div>
      </div>

      <KeypadSheet open={kp} title="Height" nextLabel="Save" onClose={() => setKp(false)}
        fields={[{ key: 'v', label: units === 'lb' ? 'Inches (5′10″ = 70)' : 'Centimetres', unit: units === 'lb' ? 'in' : 'cm', value: height, step: 1 }]}
        onDone={(v) => { setHeight(v.v); setKp(false); }} />
    </div>
  );
}
