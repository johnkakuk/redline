import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { act } from '../../app/queries';
import { db } from '../../db/client';
import { fmtDay, localDate } from '../../shared/time';
import type { Meal } from '../../shared/types';
import { Button, Field, ListRow, Segmented, Stepper, Toggle } from '../../ui/primitives';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/toast';
import { MealSheet } from './MealSheet';

/** "640 kcal · 52 g" (either part may be missing). */
export function macros(calories: number | null | undefined, protein: number | null | undefined): string {
  const parts: string[] = [];
  if (calories != null) parts.push(`${Math.round(calories)} kcal`);
  if (protein != null) parts.push(`${Math.round(protein * 10) / 10} g protein`);
  return parts.join(' · ') || '—';
}

/** Number from a text field, or null when empty. */
export const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));

export const dayLabel = (date: string) => (date === localDate() ? 'Today' : fmtDay(date, { weekday: 'short', month: 'short', day: 'numeric' }));

/** Log a saved meal (with servings) or quick-add calories and protein for a given day. */
export function LogFoodSheet({ open, onClose, date }: { open: boolean; onClose: () => void; date: string }) {
  const { data: meals = [] } = useQuery({ queryKey: ['meals'], queryFn: () => db.listMeals(), enabled: open });
  const [mode, setMode] = useState<'saved' | 'quick'>('saved');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Meal | null>(null);
  const [servings, setServings] = useState(1);
  const [name, setName] = useState('');
  const [cal, setCal] = useState('');
  const [protein, setProtein] = useState('');
  const [saveMeal, setSaveMeal] = useState(false);
  const [newMeal, setNewMeal] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch(''); setSelected(null); setServings(1); setName(''); setCal(''); setProtein(''); setSaveMeal(false);
  }, [open]);
  // Start on whichever tab can do something.
  useEffect(() => { if (open) setMode(meals.length ? 'saved' : 'quick'); }, [open, meals.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = meals.filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase()));
  const quickOk = num(cal) != null || num(protein) != null;

  const logSaved = async () => {
    if (!selected) return;
    setBusy(true);
    const id = await act(db.logFood({ date, meal_id: selected.id, servings }));
    setBusy(false);
    if (id) { toast(`Logged ${selected.name}${servings !== 1 ? ` ×${servings}` : ''}`, 'success'); onClose(); }
  };

  const logQuick = async () => {
    setBusy(true);
    const c = num(cal);
    const p = num(protein);
    let mealId: string | undefined;
    if (saveMeal && name.trim()) mealId = await act(db.saveMeal({ name, calories: c, protein_g: p }));
    const id = await act(db.logFood(mealId ? { date, meal_id: mealId } : { date, name, calories: c, protein_g: p }));
    setBusy(false);
    if (id) { toast(`Logged ${name.trim() || 'food'}`, 'success'); onClose(); }
  };

  return (
    <Sheet open={open} onClose={onClose} full title={<div>Log food<div className="caption" style={{ fontWeight: 400 }}>{dayLabel(date)}</div></div>} label="Log food"
      left={<button type="button" className="navbtn" onClick={onClose}>Cancel</button>}>
      <Segmented value={mode} onChange={setMode} options={[{ value: 'saved', label: 'Saved meals' }, { value: 'quick', label: 'Quick add' }]} />

      {mode === 'saved' ? (
        <div style={{ marginTop: 16 }}>
          {meals.length > 0 && (
            <div className="search" style={{ marginBottom: 12 }}>
              <Search size={18} />
              <input className="input" type="search" placeholder="Search meals" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search meals" />
            </div>
          )}
          <div className="list">
            {shown.map((m) => (
              <ListRow key={m.id} title={m.name} sub={macros(m.calories, m.protein_g)} chevron={false} selected={selected?.id === m.id}
                onClick={() => { setSelected(selected?.id === m.id ? null : m); setServings(1); }} />
            ))}
            {meals.length > 0 && shown.length === 0 && <div className="list-row muted">No saved meal matches.</div>}
            <ListRow title={<span className="red">New meal</span>} leading={<Plus size={18} color="var(--red-400)" />} chevron={false} onClick={() => setNewMeal(true)} />
          </div>
          {meals.length === 0 && <p className="caption" style={{ marginTop: 12 }}>Save meals you eat often and log them in one tap. Or use Quick add.</p>}

          {selected && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="row-between">
                <div>
                  <div style={{ fontWeight: 600 }}>{selected.name}</div>
                  <div className="caption">{macros(selected.calories == null ? null : selected.calories * servings, selected.protein_g == null ? null : selected.protein_g * servings)}</div>
                </div>
                <div style={{ width: 150 }}>
                  <Stepper label="servings" value={servings} min={0.5} max={10} step={0.5} format={(v) => `×${v}`} onChange={setServings} />
                </div>
              </div>
              <Button block style={{ marginTop: 12 }} disabled={busy} onClick={() => void logSaved()}>Log {selected.name}</Button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <Field label="Name (optional)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Snack" /></Field>
          <div className="form-grid">
            <Field label="Calories"><input className="input" inputMode="numeric" pattern="[0-9]*" value={cal} onChange={(e) => setCal(e.target.value.replace(/[^\d]/g, ''))} placeholder="kcal" /></Field>
            <Field label="Protein (g)"><input className="input" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value.replace(/[^\d.]/g, ''))} placeholder="g" /></Field>
          </div>
          <div className="list" style={{ marginTop: 24 }}>
            <div className="list-row">
              <div className="lr-main"><div className="lr-title">Save as a meal</div><div className="lr-sub">{name.trim() ? 'Log it in one tap next time' : 'Give it a name to save it'}</div></div>
              <Toggle label="Save as a meal" on={saveMeal && !!name.trim()} onChange={(v) => setSaveMeal(v)} />
            </div>
          </div>
          <Button block style={{ marginTop: 16 }} disabled={!quickOk || busy} onClick={() => void logQuick()}>Log</Button>
        </div>
      )}

      <MealSheet open={newMeal} onClose={() => setNewMeal(false)} initialName={search.trim()}
        onSaved={(m) => { setNewMeal(false); setSearch(''); setSelected(m); setServings(1); }} />
    </Sheet>
  );
}
