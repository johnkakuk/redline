import { useNavigate } from 'react-router-dom';

/** Open the Day screen for a local calendar date (nutrition, bodyweight and that day's workouts). */
export function useOpenDay() {
  const nav = useNavigate();
  return { open: (date: string) => nav(`/day/${date}`) };
}
