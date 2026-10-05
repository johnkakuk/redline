import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { act, useSettings } from '../../app/queries';
import { db } from '../../db/client';
import type { ExerciseInput } from '../../shared/types';
import { PushScreen } from '../../ui/Screen';
import { toast } from '../../ui/toast';
import { blankExercise, ExerciseFields } from './ExerciseFields';

/** Full-screen create/edit, reached from the library and exercise detail. */
export function ExerciseFormScreen() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const owned = useSettings().data?.owned_equipment;
  const { data: existing } = useQuery({ queryKey: ['exercise', id], queryFn: () => db.getExercise(id!), enabled: !isNew });
  const [f, setF] = useState<ExerciseInput | null>(null);

  useEffect(() => {
    if (f) return;
    if (isNew && owned) setF(blankExercise('', owned));
    if (existing) {
      const { is_seeded: _s, archived: _a, updated_at: _u, ...rest } = existing;
      setF(rest);
    }
  }, [existing, isNew, owned, f]);

  const set = <K extends keyof ExerciseInput>(k: K, v: ExerciseInput[K]) => setF((x) => x && { ...x, [k]: v });

  const save = async () => {
    if (!f) return;
    const saved = await act(db.saveExercise(f));
    if (!saved) return;
    toast('Exercise saved', 'success');
    if (isNew) nav(`/exercises/${saved}`, { replace: true });
    else nav(-1);
  };

  if (!f) return <PushScreen title="Exercise"><div aria-busy="true" /></PushScreen>;

  return (
    <PushScreen title={isNew ? 'New exercise' : 'Edit exercise'} backLabel="Cancel"
      right={<button type="button" className="navbtn strong" disabled={!f.name.trim()} onClick={() => void save()}>Save</button>}>
      <ExerciseFields f={f} set={set} autoFocus={isNew} />
    </PushScreen>
  );
}
