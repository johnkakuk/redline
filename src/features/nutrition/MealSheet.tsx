import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { act } from '../../app/queries';
import { db } from '../../db/client';
import type { Meal } from '../../shared/types';
import { Button, Field } from '../../ui/primitives';
import { ConfirmSheet, Sheet } from '../../ui/Sheet';
import { num } from './LogFoodSheet';

/** Create or edit a saved meal (calories and protein per serving). */
export function MealSheet({ open, meal, initialName = '', onClose, onSaved }: {
  open: boolean; meal?: Meal | null; initialName?: string; onClose: () => void; onSaved?: (m: Meal) => void;
}) {
  const [name, setName] = useState('');
  const [cal, setCal] = useState('');
  const [protein, setProtein] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(meal?.name ?? initialName);
    setCal(meal?.calories != null ? String(meal.calories) : '');
    setProtein(meal?.protein_g != null ? String(meal.protein_g) : '');
  }, [open, meal, initialName]);

  const ok = !!name.trim() && (num(cal) != null || num(protein) != null);
  const save = async () => {
    const m = { id: meal?.id, name, calories: num(cal), protein_g: num(protein) };
    const id = await act(db.saveMeal(m));
    if (id) onSaved?.({ id, name: name.trim(), calories: m.calories, protein_g: m.protein_g, last_used_at: meal?.last_used_at ?? null, uses: meal?.uses ?? 0 });
    if (id) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={meal ? 'Edit meal' : 'New meal'}
      left={<button type="button" className="navbtn" onClick={onClose}>Cancel</button>}
      right={<button type="button" className="navbtn strong" disabled={!ok} onClick={() => void save()}>Save</button>}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Chicken rice bowl" data-autofocus={!meal || undefined} /></Field>
      <div className="form-grid">
        <Field label="Calories"><input className="input" inputMode="numeric" pattern="[0-9]*" value={cal} onChange={(e) => setCal(e.target.value.replace(/[^\d]/g, ''))} placeholder="kcal" /></Field>
        <Field label="Protein (g)"><input className="input" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value.replace(/[^\d.]/g, ''))} placeholder="g" /></Field>
      </div>
      <p className="caption" style={{ marginTop: 12 }}>Per serving. You can log half or double servings.</p>
      {meal && (
        <>
          <Button variant="destructive" block style={{ marginTop: 24 }} onClick={() => setConfirm(true)}><Trash2 size={18} />Delete meal</Button>
          <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} title={`Delete ${meal.name}?`} destructive confirmLabel="Delete"
            body="It’s removed from your saved meals. Days you’ve already logged it on keep their numbers."
            onConfirm={() => void act(db.deleteMeal(meal.id)).then(onClose)} />
        </>
      )}
    </Sheet>
  );
}
