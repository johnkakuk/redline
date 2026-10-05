import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { act, useUnits } from '../../app/queries';
import { db } from '../../db/client';
import type { ProgramKind } from '../../db/repos/programs.repo';
import type { Equipment } from '../../shared/types';
import { KeypadSheet } from '../../ui/Keypad';
import { Badge, Button, Segmented, ValueButton } from '../../ui/primitives';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/toast';

export const EQUIPMENT_ROWS: { key: Equipment; label: string; cap?: string }[] = [
  { key: 'dumbbell', label: 'Dumbbells', cap: 'Heaviest dumbbell (per hand)' },
  { key: 'kettlebell', label: 'Kettlebells', cap: 'Heaviest kettlebell' },
  { key: 'barbell', label: 'Barbell + plates' },
  { key: 'cable', label: 'Cable machine' },
  { key: 'machine', label: 'Weight machines' },
  { key: 'pull_up_bar', label: 'Pull-up bar' },
  { key: 'band', label: 'Resistance bands' },
];

export interface EquipmentValue {
  owned: Equipment[];
  /** kg; missing = no limit */
  caps: Partial<Record<Equipment, number>>;
}

/** None / Have per equipment type, with an optional heaviest-load cap for dumbbells and kettlebells. */
export function EquipmentEditor({ value, onChange }: { value: EquipmentValue; onChange: (v: EquipmentValue) => void }) {
  const { units, toDisplay, toKg } = useUnits();
  const [kp, setKp] = useState<Equipment | null>(null);
  const has = (e: Equipment) => value.owned.includes(e);
  const setHas = (e: Equipment, on: boolean) => {
    const owned = on ? [...new Set([...value.owned, e])] : value.owned.filter((x) => x !== e);
    const caps = { ...value.caps };
    if (!on) delete caps[e];
    onChange({ owned, caps });
  };
  const row = EQUIPMENT_ROWS.find((r) => r.key === kp);
  return (
    <>
      <div className="list">
        {EQUIPMENT_ROWS.map((r) => (
          <div key={r.key} className="list-row" style={{ flexWrap: 'wrap', paddingTop: 10, paddingBottom: 10 }}>
            <div className="lr-main"><div className="lr-title">{r.label}</div></div>
            <div style={{ width: 150 }} role="group" aria-label={r.label}>
              <Segmented small value={has(r.key) ? 'have' : 'none'} onChange={(v) => setHas(r.key, v === 'have')}
                options={[{ value: 'none', label: 'None' }, { value: 'have', label: 'Have' }]} />
            </div>
            {r.cap && has(r.key) && (
              <div style={{ width: '100%', marginTop: 8 }}>
                <ValueButton label={r.cap} value={value.caps[r.key] != null ? toDisplay(value.caps[r.key]) : null} unit={units}
                  placeholder={`${r.cap}: no limit`} onClick={() => setKp(r.key)} />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="caption" style={{ marginTop: 8 }}>Bodyweight exercises are always available.</p>
      <KeypadSheet open={kp != null} title={row?.cap} nextLabel="Save" onClose={() => setKp(null)}
        fields={[{ key: 'v', label: 'Empty = no limit', unit: units, decimals: true, value: kp && value.caps[kp] != null ? toDisplay(value.caps[kp]) : null, step: units === 'lb' ? 5 : 2 }]}
        onDone={(v) => {
          if (kp) {
            const caps = { ...value.caps };
            if (v.v) caps[kp] = toKg(v.v)!; else delete caps[kp];
            onChange({ ...value, caps });
          }
          setKp(null);
        }} />
    </>
  );
}

/** Day-by-day exercise list for a starter program. */
export function ProgramPreview({ kind }: { kind: ProgramKind }) {
  const { data } = useQuery({ queryKey: ['programPreview', kind], queryFn: () => db.previewStarterProgram(kind) });
  return (
    <div className="stack-sm">
      {data?.map((d) => (
        <div className="card tight" key={d.name}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
          <div className="caption">{d.items.map((i) => `${i.name} ${i.working_sets}×${i.rep_max}`).join(' · ')}</div>
        </div>
      ))}
    </div>
  );
}

/** Pick and create a starter program (3 full-body days) that fits the user's equipment. */
export function StarterProgramSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => db.getSettings() }).data;
  const onlyBw = !!settings && settings.owned_equipment.every((e) => e === 'pull_up_bar');
  const [kind, setKind] = useState<ProgramKind>('equipment');
  const k: ProgramKind = onlyBw ? 'bodyweight' : kind;
  return (
    <Sheet open={open} onClose={onClose} full title="Starter program"
      left={<button type="button" className="navbtn" onClick={onClose}>Cancel</button>}
      right={<button type="button" className="navbtn strong" onClick={async () => {
        const ids = await act(db.createStarterProgram(k));
        onClose();
        if (ids) { toast(`Added ${ids.length} routines`, 'success'); nav('/routines'); }
      }}>Add</button>}>
      <p className="callout muted" style={{ marginBottom: 12 }}>Three full-body days. Rotate through them; weights start from your first session.</p>
      {onlyBw
        ? <div style={{ marginBottom: 12 }}><Badge tone="info">Bodyweight only · no equipment set</Badge></div>
        : <div style={{ marginBottom: 12 }}><Segmented value={kind} onChange={setKind} options={[{ value: 'equipment', label: 'My equipment' }, { value: 'bodyweight', label: 'Bodyweight only' }]} /></div>}
      <ProgramPreview kind={k} />
      <Button block style={{ marginTop: 16 }} variant="secondary" onClick={() => { onClose(); nav('/settings'); }}>Edit my equipment</Button>
    </Sheet>
  );
}
