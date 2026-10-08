import { useQuery } from '@tanstack/react-query';
import { BookmarkPlus, Copy, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { act } from '../../app/queries';
import { db } from '../../db/client';
import { localDate } from '../../shared/time';
import type { FoodEntry } from '../../shared/types';
import { Button, Field, ListRow } from '../../ui/primitives';
import { ActionSheet, Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/toast';
import { macros, num } from './LogFoodSheet';

/** A day's food log: tap an entry to edit, log it again today, save it as a meal, or delete it. */
export function FoodLogList({ date, empty }: { date: string; empty?: string }) {
  const { data: entries = [] } = useQuery({ queryKey: ['food', date], queryFn: () => db.listFood(date) });
  const [menu, setMenu] = useState<FoodEntry | null>(null);
  const [editing, setEditing] = useState<FoodEntry | null>(null);
  const today = localDate();

  if (!entries.length) return <div className="card"><p className="muted">{empty ?? 'Nothing logged.'}</p></div>;
  return (
    <>
      <div className="list">
        {entries.map((e) => (
          <ListRow key={e.id} title={e.name ?? 'Quick add'} chevron={false} onClick={() => setMenu(e)}
            sub={`${new Date(e.logged_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${e.servings !== 1 ? ` · ×${e.servings}` : ''}`}
            value={macros(e.calories, e.protein_g).replace(' protein', '')} />
        ))}
      </div>
      <ActionSheet open={!!menu} onClose={() => setMenu(null)} title={menu?.name ?? 'Entry'} actions={[
        { label: 'Edit', icon: <Pencil size={20} />, onSelect: () => setEditing(menu) },
        { label: date === today ? 'Log again' : 'Log again today', icon: <Copy size={20} />,
          onSelect: () => void act(db.logFood(menu!.meal_id ? { date: today, meal_id: menu!.meal_id, servings: menu!.servings } : { date: today, name: menu!.name, calories: menu!.calories, protein_g: menu!.protein_g })).then((id) => id && toast('Logged again', 'success')) },
        { label: 'Save as a meal', icon: <BookmarkPlus size={20} />, hidden: !!menu?.meal_id,
          onSelect: () => void act(db.saveMeal({ name: menu!.name || 'Meal', calories: menu!.calories, protein_g: menu!.protein_g })).then((id) => id && toast('Saved to your meals', 'success')) },
        { label: 'Delete', icon: <Trash2 size={20} />, danger: true, onSelect: () => void act(db.deleteFood(menu!.id)) },
      ]} />
      <EditEntrySheet entry={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function EditEntrySheet({ entry, onClose }: { entry: FoodEntry | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [cal, setCal] = useState('');
  const [protein, setProtein] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (entry && loadedFor !== entry.id) {
    setLoadedFor(entry.id);
    setName(entry.name ?? '');
    setCal(entry.calories != null ? String(entry.calories) : '');
    setProtein(entry.protein_g != null ? String(entry.protein_g) : '');
  }
  const ok = num(cal) != null || num(protein) != null;
  return (
    <Sheet open={!!entry} onClose={onClose} title="Edit entry"
      left={<button type="button" className="navbtn" onClick={onClose}>Cancel</button>}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Quick add" /></Field>
      <div className="form-grid">
        <Field label="Calories"><input className="input" inputMode="numeric" pattern="[0-9]*" value={cal} onChange={(e) => setCal(e.target.value.replace(/[^\d]/g, ''))} /></Field>
        <Field label="Protein (g)"><input className="input" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
      </div>
      <Button block style={{ marginTop: 24 }} disabled={!ok} onClick={() => {
        if (!entry) return;
        void act(db.updateFood(entry.id, { name, calories: num(cal), protein_g: num(protein) })).then(() => { setLoadedFor(null); onClose(); });
      }}>Save</Button>
    </Sheet>
  );
}
