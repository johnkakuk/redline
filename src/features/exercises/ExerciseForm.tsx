import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { act, useSettings, useUnits } from '../../app/queries';
import { db } from '../../db/client';
import { EQUIPMENT_LABEL, LOAD_TYPE_LABEL, MUSCLE_LABEL } from '../../shared/labels';
import { EQUIPMENT, LOAD_TYPES, MUSCLES, type ExerciseInput } from '../../shared/types';
import { Term } from '../../ui/InfoTip';
import { KeypadSheet } from '../../ui/Keypad';
import { Chip, Field, Stepper, ValueButton } from '../../ui/primitives';
import { PushScreen } from '../../ui/Screen';
import { toast } from '../../ui/toast';
import { ExercisePicker } from './ExercisePicker';

const blank: ExerciseInput = {
  name: '', primary_muscle: 'chest', secondary_muscles: [], equipment: 'dumbbell', load_type: 'per_hand',
  default_increment_kg: null, max_load_kg: null, harder_variation_id: null, easier_variation_id: null, default_rest_sec: null, notes: null,
};

export function ExerciseFormScreen() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const { w, units, toDisplay, toKg } = useUnits();
  const settings = useSettings().data;
  const { data: existing } = useQuery({ queryKey: ['exercise', id], queryFn: () => db.getExercise(id!), enabled: !isNew });
  const [f, setF] = useState<ExerciseInput>(blank);
  const [loaded, setLoaded] = useState(isNew);
  const [kp, setKp] = useState<null | 'inc' | 'cap'>(null);
  const [pick, setPick] = useState<null | 'harder' | 'easier'>(null);
  const names = useQuery({
    queryKey: ['exNames', f.harder_variation_id, f.easier_variation_id],
    queryFn: async () => ({
      harder: f.harder_variation_id ? (await db.getExercise(f.harder_variation_id)).name : null,
      easier: f.easier_variation_id ? (await db.getExercise(f.easier_variation_id)).name : null,
    }),
  }).data;

  useEffect(() => {
    if (existing && !loaded) {
      const { is_seeded: _s, archived: _a, updated_at: _u, ...rest } = existing;
      setF(rest);
      setLoaded(true);
    }
  }, [existing, loaded]);

  const set = <K extends keyof ExerciseInput>(k: K, v: ExerciseInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const defInc = settings?.default_increment[f.equipment];

  const save = async () => {
    const saved = await act(db.saveExercise(f));
    if (!saved) return;
    toast('Exercise saved', 'success');
    if (isNew) nav(`/exercises/${saved}`, { replace: true });
    else nav(-1);
  };

  if (!loaded) return <PushScreen title="Exercise"><div aria-busy="true" /></PushScreen>;
  const bw = f.load_type === 'bodyweight';

  return (
    <PushScreen title={isNew ? 'New exercise' : 'Edit exercise'} backLabel="Cancel"
      right={<button type="button" className="navbtn strong" disabled={!f.name.trim()} onClick={() => void save()}>Save</button>}>
      <Field label="Name"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Incline DB Press" autoFocus={isNew} /></Field>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <Field label="Equipment">
          <select className="select" value={f.equipment} onChange={(e) => set('equipment', e.target.value as ExerciseInput['equipment'])}>
            {EQUIPMENT.map((x) => <option key={x} value={x}>{EQUIPMENT_LABEL[x]}</option>)}
          </select>
        </Field>
        <Field label="Load type" hint={<Term k="load_type">What’s this?</Term>}>
          <select className="select" value={f.load_type} onChange={(e) => set('load_type', e.target.value as ExerciseInput['load_type'])}>
            {LOAD_TYPES.map((x) => <option key={x} value={x}>{LOAD_TYPE_LABEL[x]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Primary muscle">
        <select className="select" value={f.primary_muscle} onChange={(e) => set('primary_muscle', e.target.value as ExerciseInput['primary_muscle'])}>
          {MUSCLES.map((m) => <option key={m} value={m}>{MUSCLE_LABEL[m]}</option>)}
        </select>
      </Field>
      <div className="field">
        <span className="micro field-label">Secondary muscles</span>
        <div className="chips" style={{ flexWrap: 'wrap', margin: 0, padding: 0 }}>
          {MUSCLES.filter((m) => m !== f.primary_muscle).map((m) => (
            <Chip key={m} on={f.secondary_muscles.includes(m)} onClick={() => set('secondary_muscles', f.secondary_muscles.includes(m) ? f.secondary_muscles.filter((x) => x !== m) : [...f.secondary_muscles, m])}>
              {MUSCLE_LABEL[m]}
            </Chip>
          ))}
        </div>
      </div>
      {!bw && (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="Increment" hint={<Term k="increment">{f.load_type === 'per_hand' ? 'Per dumbbell' : 'Step size'}</Term>} group>
            <ValueButton label="Increment" value={f.default_increment_kg != null ? w(f.default_increment_kg) : null} unit={units}
              placeholder={`${w(defInc)} ${units} default`} onClick={() => setKp('inc')} />
          </Field>
          <Field label="Max load (cap)" hint={<Term k="cap">Your heaviest available</Term>} group>
            <ValueButton label="Max load" value={f.max_load_kg != null ? w(f.max_load_kg) : null} unit={units} placeholder="No cap" onClick={() => setKp('cap')} />
          </Field>
        </div>
      )}
      <div className="field" style={{ marginTop: 12 }}>
        <span className="micro field-label">Default rest</span>
        <Stepper label="rest" value={f.default_rest_sec ?? settings?.default_rest_sec ?? 90} min={0} max={600} step={15}
          format={(s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`} onChange={(v) => set('default_rest_sec', v)} />
      </div>
      <div className="section">
        <div className="section-label"><span className="micro">Variations</span></div>
        <div className="list">
          {(['easier', 'harder'] as const).map((k) => {
            const idKey = k === 'harder' ? 'harder_variation_id' : 'easier_variation_id';
            return (
              <div className="list-row" key={k}>
                <button type="button" className="lr-main" style={{ textAlign: 'left' }} onClick={() => setPick(k)}>
                  <div className="lr-title">{names?.[k] ?? <span className="dim">None</span>}</div>
                  <div className="lr-sub">{k === 'harder' ? 'Harder (suggested when capped)' : 'Easier'}</div>
                </button>
                {f[idKey] && <button type="button" className="icon-btn" aria-label={`Clear ${k} variation`} onClick={() => set(idKey, null)}><X size={18} /></button>}
              </div>
            );
          })}
        </div>
      </div>
      <Field label="Notes"><textarea className="textarea" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Setup, cues…" /></Field>

      <KeypadSheet open={kp != null} title={kp === 'inc' ? 'Increment' : 'Max load'} nextLabel="Save" onClose={() => setKp(null)}
        fields={[{ key: 'v', label: kp === 'inc' ? 'Increment (empty = default)' : 'Heaviest available (empty = no cap)', unit: units, decimals: true,
          value: toDisplay(kp === 'inc' ? f.default_increment_kg : f.max_load_kg), step: kp === 'inc' ? 0.5 : toDisplay(f.default_increment_kg ?? defInc) ?? 5 }]}
        onDone={(v) => { set(kp === 'inc' ? 'default_increment_kg' : 'max_load_kg', v.v ? toKg(v.v) : null); setKp(null); }} />
      <ExercisePicker open={pick != null} single title={pick === 'harder' ? 'Harder variation' : 'Easier variation'} onClose={() => setPick(null)}
        onPick={([x]) => pick && set(pick === 'harder' ? 'harder_variation_id' : 'easier_variation_id', x === f.id ? null : x)} />
    </PushScreen>
  );
}
