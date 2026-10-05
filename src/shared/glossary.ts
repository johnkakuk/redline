/** Plain-language explanations for terms a non-lifter might not know. Shown by <InfoTip>. */
export const GLOSSARY = {
  calorie_intensity: {
    title: 'Calorie intensity',
    body: 'How hard your sessions usually are. It only affects the calorie estimate, not your workouts. Light: long rests, easy sets. Moderate: typical lifting with 1–2 minute rests. Vigorous: short rests, supersets, sets close to failure.',
  },
  default_rest: {
    title: 'Default rest',
    body: 'How long the rest timer runs after each working set, unless an exercise or routine sets its own.',
  },
  weekly_target: {
    title: 'Sessions per week',
    body: 'How many workouts a week you’re aiming for. Every week that hits this number extends your streak.',
  },
  increment: {
    title: 'Increment',
    body: 'How much weight is added when you’ve earned a step up. Dumbbell increments are per dumbbell. Individual exercises can override it.',
  },
  equipment: {
    title: 'Your equipment',
    body: 'Starter programs and the exercise list only use what you have. Your heaviest dumbbell or kettlebell caps weight suggestions; once you max it out, Redline suggests a harder variation instead.',
  },
  storage: {
    title: 'Storage',
    body: 'Persistent: iOS won’t clear Redline’s data to free up space. Best effort: it could, if the phone runs very low on space. Either way, keep a backup.',
  },
  progression: {
    title: 'Progression',
    body: 'Double: keep the same weight and add reps until every set reaches the top of the rep range, then add weight and start again at the bottom. Off: Redline never changes your targets.',
  },
  rep_range: {
    title: 'Rep range',
    body: 'Each set aims for between the min and max reps. Hit the max on every set and the weight goes up next time. Below the min three sessions in a row and Redline suggests a lighter weight (a deload).',
  },
  warmups: {
    title: 'Warm-up sets',
    body: 'Lighter sets before your working sets, at about 50%, 70% and 85% of the working weight. They don’t count toward progression or stats.',
  },
  cap: {
    title: 'Cap',
    body: 'The heaviest weight you have for this exercise. Suggestions never go above it. Leave empty to use the exercise’s own cap.',
  },
  load_type: {
    title: 'Load type',
    body: 'Total load: the number is everything on the bar or machine. Per hand: the weight of one dumbbell. Bodyweight only: no added weight, progress by reps. Bodyweight + load: you add weight with a belt or vest.',
  },
  e1rm: {
    title: 'Estimated 1RM',
    body: 'Estimated one-rep max: roughly the most you could lift for a single rep, calculated from a set of up to 12 reps. It lets you compare a heavy set of 5 with a lighter set of 10.',
  },
  tonnage: {
    title: 'Tonnage',
    body: 'Total weight moved: weight × reps added up over every working set. Both dumbbells count.',
  },
  volume: {
    title: 'Sets per muscle',
    body: 'Working sets this week for each muscle. An exercise counts as a full set for its main muscle and half a set for helper muscles. 10–20 sets a week (the shaded band) is a common target for building muscle.',
  },
  streak: {
    title: 'Streak',
    body: 'Consecutive weeks where you hit your sessions-per-week target. The current week counts once you reach it.',
  },
  kcal: {
    title: 'Estimated calories',
    body: 'An estimate from your bodyweight, active time (long pauses removed), calorie intensity setting and, if you’ve added them, your sex, age and height. Treat it as a ballpark.',
  },
  cloud: {
    title: 'Cloud backup',
    body: 'Copies your data to your own private database so a lost or reset phone isn’t a lost history. The phone stays the main copy and works fully offline; changes upload in the background when there’s a connection.',
  },
  superset: {
    title: 'Superset',
    body: 'Two or more exercises done back to back: one set of each, then rest. Good for saving time with exercises that don’t compete for the same muscles.',
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
