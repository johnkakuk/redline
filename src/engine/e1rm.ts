/** Epley estimated 1RM. Only meaningful for 1–12 reps; returns null otherwise. */
export function e1rm(weightKg: number, reps: number): number | null {
  if (!(reps >= 1) || reps > 12 || !(weightKg > 0)) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}
