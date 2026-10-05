import { useQuery } from '@tanstack/react-query';
import { Download, FileText, ListPlus, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { act, queryClient, useSettings, useUnits } from '../../app/queries';
import { db } from '../../db/client';
import { EQUIPMENT_LABEL } from '../../shared/labels';
import { relativeDays } from '../../shared/time';
import { EQUIPMENT, type Equipment, type Intensity } from '../../shared/types';
import { KeypadSheet, type KeypadField } from '../../ui/Keypad';
import { Term } from '../../ui/InfoTip';
import { Badge, Button, ListRow, Segmented, Stepper } from '../../ui/primitives';
import { EquipmentEditor, StarterProgramSheet } from '../onboarding/equipment';
import { Screen } from '../../ui/Screen';
import { Sheet } from '../../ui/Sheet';
import { toast, toastError } from '../../ui/toast';

export async function shareOrDownload(filename: string, content: string, mime: string) {
  const file = new File([content], filename, { type: mime });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const stamp = () => new Date().toISOString().slice(0, 10);
const INCH = 2.54;

type Kp = null | 'height' | 'calories' | 'protein' | { inc: Equipment };

export function SettingsScreen() {
  const s = useSettings().data;
  const { units, w, toDisplay, toKg } = useUnits();
  const nav = useNavigate();
  const [kp, setKp] = useState<Kp>(null);
  const [importing, setImporting] = useState<null | { json: unknown; preview: Awaited<ReturnType<typeof db.previewImport>> }>(null);
  const [reset, setReset] = useState(false);
  const [starter, setStarter] = useState(false);
  const [resetText, setResetText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const boot = useQuery({ queryKey: ['boot'], queryFn: () => db.boot() }).data;
  const stats = useQuery({ queryKey: ['dataStats'], queryFn: () => db.dataStats() }).data;
  const storage = useQuery({
    queryKey: ['storage'],
    queryFn: async () => ({
      persisted: (await navigator.storage?.persisted?.()) ?? false,
      estimate: await navigator.storage?.estimate?.().catch(() => null),
    }),
  }).data;
  if (!s) return null;

  const upd = (p: Parameters<typeof db.updateSettings>[0]) => act(db.updateSettings(p));
  const heightDisplay = s.height_cm == null ? null : units === 'lb' ? `${Math.floor(s.height_cm / INCH / 12)}′${Math.round((s.height_cm / INCH) % 12)}″` : `${Math.round(s.height_cm)} cm`;

  const kpFields = (): KeypadField[] => {
    if (kp === 'height') return [{ key: 'v', label: units === 'lb' ? 'Height (inches)' : 'Height (cm)', unit: units === 'lb' ? 'in' : 'cm', value: s.height_cm == null ? null : Math.round(units === 'lb' ? s.height_cm / INCH : s.height_cm), step: 1 }];
    if (kp === 'calories') return [{ key: 'v', label: 'Daily calories', unit: 'kcal', value: s.calorie_target, step: 50 }];
    if (kp === 'protein') return [{ key: 'v', label: 'Daily protein', unit: 'g', value: s.protein_target_g, step: 5 }];
    if (kp && typeof kp === 'object') return [{ key: 'v', label: `${EQUIPMENT_LABEL[kp.inc]} increment`, unit: units, decimals: true, value: toDisplay(s.default_increment[kp.inc]), step: 0.5 }];
    return [];
  };

  const onKp = async (v: number | null) => {
    const k = kp;
    setKp(null);
    if (k === 'height') await upd({ height_cm: v == null ? null : units === 'lb' ? v * INCH : v });
    else if (k === 'calories') await upd({ calorie_target: v });
    else if (k === 'protein') await upd({ protein_target_g: v });
    else if (k && typeof k === 'object' && v) await upd({ default_increment: { ...s.default_increment, [k.inc]: toKg(v)! } });
  };

  const exportJson = async () => {
    const data = await db.exportAll();
    await shareOrDownload(`redline-${stamp()}.json`, JSON.stringify(data), 'application/json');
    void queryClient.invalidateQueries({ queryKey: ['settings'] });
  };

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      setImporting({ json, preview: await db.previewImport(json) });
    } catch (e) {
      toastError(e instanceof SyntaxError ? new Error('Not a valid JSON file') : e);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doImport = async (mode: 'replace' | 'merge') => {
    if (!importing) return;
    const res = await act(db.importAll(importing.json, mode));
    setImporting(null);
    if (res) toast(`Imported ${Object.values(res).reduce((a, b) => a + b, 0)} rows`, 'success');
  };

  const usageMb = storage?.estimate?.usage != null ? (storage.estimate.usage / 1024 / 1024).toFixed(1) : null;
  const exportAge = s.last_export_at ? relativeDays(s.last_export_at) : null;
  const staleExport = !s.last_export_at || Date.now() - Date.parse(s.last_export_at) > 14 * 86400000;

  return (
    <Screen title="Settings">
      <div className="section-label"><span className="micro">Units</span></div>
      <Segmented value={s.units} options={[{ value: 'lb', label: 'Pounds (lb)' }, { value: 'kg', label: 'Kilograms (kg)' }]} onChange={(u) => void act(db.setUnits(u))} />

      <div className="section">
        <div className="section-label"><span className="micro">Profile</span><span className="caption">Used for calorie estimates</span></div>
        <div className="list">
          <div className="list-row">
            <div className="lr-main"><div className="lr-title">Sex</div></div>
            <div style={{ width: 180 }}>
              <Segmented small value={s.sex ?? 'none'} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'none', label: '—' }]}
                onChange={(v) => void upd({ sex: v === 'none' ? null : v })} />
            </div>
          </div>
          <label className="list-row">
            <div className="lr-main"><div className="lr-title">Birth date</div></div>
            <input type="date" className="input" style={{ width: 170, height: 40 }} value={s.birth_date ?? ''} onChange={(e) => void upd({ birth_date: e.target.value || null })} />
          </label>
          <ListRow title="Height" value={heightDisplay ?? <span className="dim">Not set</span>} onClick={() => setKp('height')} />
          <ListRow title="Bodyweight" value={<span className="dim">Logged in Body</span>} onClick={() => nav('/body')} />
        </div>
      </div>

      <div className="section">
        <div className="section-label"><span className="micro">Training</span></div>
        <div className="list">
          <div className="list-row">
            <div className="lr-main"><div className="lr-title"><Term k="default_rest">Default rest</Term></div></div>
            <div style={{ width: 160 }}><Stepper label="default rest" value={s.default_rest_sec} min={15} max={600} step={15}
              format={(v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`} onChange={(v) => void upd({ default_rest_sec: v })} /></div>
          </div>
          <div className="list-row">
            <div className="lr-main"><div className="lr-title"><Term k="weekly_target">Sessions per week</Term></div><div className="lr-sub">Target for streaks</div></div>
            <div style={{ width: 160 }}><Stepper label="weekly target" value={s.weekly_target} min={1} max={14} onChange={(v) => void upd({ weekly_target: v })} /></div>
          </div>
          <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, paddingTop: 12, paddingBottom: 12 }}>
            <div className="lr-title"><Term k="calorie_intensity">Calorie intensity</Term></div>
            <Segmented small value={s.calorie_intensity} onChange={(v: Intensity) => void upd({ calorie_intensity: v })}
              options={[{ value: 'light', label: 'Light' }, { value: 'moderate', label: 'Moderate' }, { value: 'vigorous', label: 'Vigorous' }]} />
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-label"><Term k="equipment" micro>Equipment</Term></div>
        <EquipmentEditor value={{ owned: s.owned_equipment, caps: s.equipment_caps }}
          onChange={(v) => {
            const cleared = Object.fromEntries(Object.keys(s.equipment_caps).filter((e) => !(e in v.caps)).map((e) => [e, null]));
            void act(db.setEquipment(v.owned, { ...cleared, ...v.caps }));
          }} />
        <div className="list" style={{ marginTop: 12 }}>
          <ListRow title="Add a starter program" sub="Three full-body days that fit your equipment" leading={<ListPlus size={20} className="red" />} onClick={() => setStarter(true)} />
        </div>
      </div>

      <div className="section">
        <div className="section-label"><span className="micro">Daily targets</span></div>
        <div className="list">
          <ListRow title="Calories" value={s.calorie_target ? `${s.calorie_target} kcal` : <span className="dim">Not set</span>} onClick={() => setKp('calories')} />
          <ListRow title="Protein" value={s.protein_target_g ? `${s.protein_target_g} g` : <span className="dim">Not set</span>} onClick={() => setKp('protein')} />
        </div>
      </div>

      <div className="section">
        <div className="section-label"><Term k="increment" micro>Default increments</Term><span className="caption">Per exercise overrides win</span></div>
        <div className="list">
          {EQUIPMENT.filter((e) => e !== 'bodyweight').map((e) => (
            <ListRow key={e} title={EQUIPMENT_LABEL[e]} value={`${w(s.default_increment[e])} ${units}${e === 'dumbbell' ? '/hand' : ''}`} onClick={() => setKp({ inc: e })} />
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-label"><span className="micro">Data</span></div>
        {staleExport && (
          <div className="banner"><TriangleAlert size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>{exportAge ? `Last backup ${exportAge}.` : 'No backup yet.'} Data lives only on this phone. Deleting the app from the home screen deletes it.</span>
          </div>
        )}
        <div className="list">
          <ListRow title="Export backup (JSON)" sub={exportAge ? `Last exported ${exportAge}` : 'Save to Files or iCloud Drive'} leading={<Download size={20} className="red" />} onClick={() => void exportJson()} />
          <ListRow title="Import backup" sub="Replace or merge" leading={<Upload size={20} className="red" />} onClick={() => fileRef.current?.click()} />
          <ListRow title="Export sets (CSV)" sub="For spreadsheets" leading={<FileText size={20} className="red" />}
            onClick={async () => shareOrDownload(`redline-sets-${stamp()}.csv`, await db.exportSetsCsv(), 'text/csv')} />
          <ListRow title="Rebuild PRs" sub="Recompute records from all sets" leading={<RotateCcw size={20} className="red" />}
            onClick={() => void act(db.rebuildPrs()).then(() => toast('PRs rebuilt', 'success'))} />
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
        <div className="list" style={{ marginTop: 12 }}>
          <ListRow title={<Term k="storage">Storage</Term>} value={
            boot?.vfs === 'memory' ? <Badge tone="warning">Not saving</Badge>
              : storage?.persisted ? <Badge tone="success">Persistent</Badge> : <Badge tone="warning">Best effort</Badge>} />
          {usageMb && <ListRow title="Used" value={`${usageMb} MB`} />}
          {stats && <ListRow title="Workouts" value={`${stats.workouts} · ${stats.sets} sets`} />}
        </div>
        <Button variant="destructive" block style={{ marginTop: 16 }} onClick={() => { setResetText(''); setReset(true); }}>Reset app</Button>
      </div>

      <div className="section center caption">
        <div className="wordmark" style={{ fontSize: 28 }}>RED<span>LINE</span></div>
        <div style={{ marginTop: 4 }}>v{__APP_VERSION__} · schema {boot?.schemaVersion ?? '—'} · {boot?.vfs ?? '…'}</div>
      </div>

      <StarterProgramSheet open={starter} onClose={() => setStarter(false)} />

      <KeypadSheet open={kp != null} title="Settings" nextLabel="Save" fields={kpFields()} onClose={() => setKp(null)} onDone={(v) => void onKp(v.v)} />

      <Sheet open={!!importing} onClose={() => setImporting(null)} title="Import backup">
        {importing && (
          <>
            <p className="callout muted">Exported {new Date(importing.preview.exportedAt).toLocaleString()}</p>
            <div className="list" style={{ marginTop: 12 }}>
              {Object.entries(importing.preview.counts).filter(([, n]) => n > 0).map(([t, n]) => <ListRow key={t} title={t.replace(/_/g, ' ')} value={n} />)}
            </div>
            <p className="caption" style={{ marginTop: 12 }}>Merge keeps whichever copy of each record was edited last. Replace wipes this phone first.</p>
            <div className="btn-row" style={{ marginTop: 16 }}>
              <Button variant="destructive" onClick={() => void doImport('replace')}>Replace</Button>
              <Button onClick={() => void doImport('merge')}>Merge</Button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={reset} onClose={() => setReset(false)} title="Reset app">
        <p className="callout muted">This permanently deletes every workout, routine, custom exercise and log on this phone. Export a backup first.</p>
        <label className="field" style={{ marginTop: 16 }}>
          <span className="micro field-label">Type RESET to confirm</span>
          <input className="input" value={resetText} onChange={(e) => setResetText(e.target.value)} autoCapitalize="characters" autoComplete="off" />
        </label>
        <Button variant="destructive" block style={{ marginTop: 16 }} disabled={resetText.trim() !== 'RESET'}
          onClick={async () => { setReset(false); await act(db.resetApp()); nav('/onboarding', { replace: true }); }}>Delete everything</Button>
      </Sheet>
    </Screen>
  );
}
