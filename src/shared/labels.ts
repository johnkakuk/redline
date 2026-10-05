import type { Equipment, LoadType, Muscle } from './types';

export const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: 'Chest', upper_back: 'Upper back', lats: 'Lats', traps: 'Traps',
  front_delts: 'Front delts', side_delts: 'Side delts', rear_delts: 'Rear delts',
  biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms', abs: 'Abs', obliques: 'Obliques',
  lower_back: 'Lower back', glutes: 'Glutes', quads: 'Quads', hamstrings: 'Hamstrings',
  adductors: 'Adductors', calves: 'Calves',
};

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Barbell', dumbbell: 'Dumbbell', kettlebell: 'Kettlebell', cable: 'Cable',
  machine: 'Machine', pull_up_bar: 'Pull-up bar', bodyweight: 'Bodyweight', band: 'Band', other: 'Other',
};

export const LOAD_TYPE_LABEL: Record<LoadType, string> = {
  total: 'Total load', per_hand: 'Per hand', bodyweight: 'Bodyweight only', bodyweight_plus: 'Bodyweight + load',
};
