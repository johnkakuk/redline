// Generates src/db/seed/exercises.json. Columns: name | equipment | load_type | primary | secondary (comma) | harder | rest
const rows = `
Barbell Back Squat|barbell|total|quads|glutes,adductors,lower_back||180
Barbell Front Squat|barbell|total|quads|glutes,abs||180
Barbell Bench Press|barbell|total|chest|triceps,front_delts||150
Incline Barbell Bench Press|barbell|total|chest|front_delts,triceps||150
Close-Grip Bench Press|barbell|total|triceps|chest,front_delts||150
Deadlift|barbell|total|hamstrings|glutes,lower_back,traps,forearms||180
Sumo Deadlift|barbell|total|glutes|hamstrings,adductors,quads,lower_back||180
Romanian Deadlift|barbell|total|hamstrings|glutes,lower_back||150
Overhead Press|barbell|total|front_delts|side_delts,triceps||150
Barbell Row|barbell|total|upper_back|lats,rear_delts,biceps||150
Pendlay Row|barbell|total|upper_back|lats,rear_delts,lower_back||150
Barbell Hip Thrust|barbell|total|glutes|hamstrings||120
Good Morning|barbell|total|hamstrings|lower_back,glutes||120
Barbell Curl|barbell|total|biceps|forearms||
EZ-Bar Skull Crusher|barbell|total|triceps|||
DB Bench Press|dumbbell|per_hand|chest|triceps,front_delts|Single-Arm DB Bench Press|120
Single-Arm DB Bench Press|dumbbell|per_hand|chest|triceps,front_delts,obliques|Deficit Pause DB Press|120
Deficit Pause DB Press|dumbbell|per_hand|chest|triceps,front_delts||120
Incline DB Press|dumbbell|per_hand|chest|front_delts,triceps|Single-Arm Incline DB Press|120
Single-Arm Incline DB Press|dumbbell|per_hand|chest|front_delts,triceps,obliques||120
DB Floor Press|dumbbell|per_hand|chest|triceps||
DB Fly|dumbbell|per_hand|chest|front_delts||
DB Shoulder Press|dumbbell|per_hand|front_delts|side_delts,triceps|Single-Arm DB Shoulder Press|120
Single-Arm DB Shoulder Press|dumbbell|per_hand|front_delts|side_delts,triceps,obliques|Seated DB Z-Press|120
Seated DB Z-Press|dumbbell|per_hand|front_delts|side_delts,triceps,abs||120
Lateral Raise|dumbbell|per_hand|side_delts||Lean-Away Lateral Raise|
Lean-Away Lateral Raise|dumbbell|per_hand|side_delts|||
Rear Delt Fly|dumbbell|per_hand|rear_delts|upper_back||
One-Arm DB Row|dumbbell|per_hand|lats|upper_back,biceps,rear_delts||
Chest-Supported DB Row|dumbbell|per_hand|upper_back|lats,rear_delts,biceps||
DB Pullover|dumbbell|total|lats|chest,triceps||
DB Shrug|dumbbell|per_hand|traps|forearms||
DB Curl|dumbbell|per_hand|biceps|forearms|Incline DB Curl|
Incline DB Curl|dumbbell|per_hand|biceps|||
Hammer Curl|dumbbell|per_hand|biceps|forearms||
Overhead DB Triceps Extension|dumbbell|total|triceps|||
DB Skull Crusher|dumbbell|per_hand|triceps|||
Goblet Squat|dumbbell|total|quads|glutes,adductors|DB Bulgarian Split Squat|120
DB Bulgarian Split Squat|dumbbell|per_hand|quads|glutes,adductors|Pause Bulgarian Split Squat|120
Pause Bulgarian Split Squat|dumbbell|per_hand|quads|glutes,adductors||120
DB Walking Lunge|dumbbell|per_hand|quads|glutes,hamstrings||
DB Step-Up|dumbbell|per_hand|quads|glutes||
DB RDL|dumbbell|per_hand|hamstrings|glutes,lower_back|Single-Leg DB RDL|120
Single-Leg DB RDL|dumbbell|per_hand|hamstrings|glutes,lower_back||120
DB Hip Thrust|dumbbell|total|glutes|hamstrings||
DB Calf Raise|dumbbell|per_hand|calves|||
DB Farmer Carry|dumbbell|per_hand|forearms|traps,abs||
KB Swing|kettlebell|total|glutes|hamstrings,lower_back|Single-Arm KB Swing|
Single-Arm KB Swing|kettlebell|total|glutes|hamstrings,lower_back,obliques||
KB Goblet Squat|kettlebell|total|quads|glutes,adductors||
KB Clean and Press|kettlebell|total|front_delts|glutes,triceps,traps||
KB Turkish Get-Up|kettlebell|total|abs|front_delts,glutes,obliques||
KB Snatch|kettlebell|total|glutes|hamstrings,front_delts,traps||
Cable Fly|cable|total|chest|front_delts||
Triceps Pushdown|cable|total|triceps|||
Overhead Cable Extension|cable|total|triceps|||
Cable Curl|cable|total|biceps|forearms||
Face Pull|cable|total|rear_delts|upper_back,traps||
Cable Lateral Raise|cable|total|side_delts|||
Lat Pulldown|cable|total|lats|biceps,upper_back||
Seated Cable Row|cable|total|upper_back|lats,biceps,rear_delts||
Cable Crunch|cable|total|abs|||
Pallof Press|cable|total|obliques|abs||
Cable Pull-Through|cable|total|glutes|hamstrings||
Leg Press|machine|total|quads|glutes,adductors||150
Hack Squat|machine|total|quads|glutes||150
Leg Extension|machine|total|quads|||
Lying Leg Curl|machine|total|hamstrings|||
Seated Leg Curl|machine|total|hamstrings|||
Machine Chest Press|machine|total|chest|triceps,front_delts||
Pec Deck|machine|total|chest|front_delts||
Machine Shoulder Press|machine|total|front_delts|side_delts,triceps||
Standing Calf Raise|machine|total|calves|||
Hip Adduction|machine|total|adductors|||
Push-up|bodyweight|bodyweight|chest|triceps,front_delts,abs|Decline Push-up|
Decline Push-up|bodyweight|bodyweight|chest|front_delts,triceps|Deficit Push-up|
Deficit Push-up|bodyweight|bodyweight|chest|triceps,front_delts|Archer Push-up|
Archer Push-up|bodyweight|bodyweight|chest|triceps,front_delts,obliques||
Inverted Row|bodyweight|bodyweight|upper_back|lats,biceps,rear_delts|Feet-Elevated Inverted Row|
Feet-Elevated Inverted Row|bodyweight|bodyweight|upper_back|lats,biceps,rear_delts|Pull-up|
Pull-up|bodyweight|bodyweight|lats|biceps,upper_back|Weighted Pull-up|120
Weighted Pull-up|bodyweight|bodyweight_plus|lats|biceps,upper_back||150
Chin-up|bodyweight|bodyweight|lats|biceps||120
Dip|bodyweight|bodyweight|chest|triceps,front_delts|Weighted Dip|120
Weighted Dip|bodyweight|bodyweight_plus|chest|triceps,front_delts||150
Bodyweight Squat|bodyweight|bodyweight|quads|glutes|Split Squat|
Split Squat|bodyweight|bodyweight|quads|glutes,adductors|Assisted Pistol Squat|
Assisted Pistol Squat|bodyweight|bodyweight|quads|glutes|Pistol Squat|
Pistol Squat|bodyweight|bodyweight|quads|glutes,abs||
Glute Bridge|bodyweight|bodyweight|glutes|hamstrings|Single-Leg Glute Bridge|
Single-Leg Glute Bridge|bodyweight|bodyweight|glutes|hamstrings||
Hanging Knee Raise|bodyweight|bodyweight|abs|obliques|Hanging Leg Raise|
Hanging Leg Raise|bodyweight|bodyweight|abs|obliques||
Plank|bodyweight|bodyweight|abs|obliques||
Side Plank|bodyweight|bodyweight|obliques|abs||
Bodyweight Calf Raise|bodyweight|bodyweight|calves|||
Band Pull-Apart|band|total|rear_delts|upper_back||
Band Triceps Pushdown|band|total|triceps|||
`.trim().split('\n');

const notes = { Plank: 'Log seconds as reps.', 'Side Plank': 'Log seconds per side as reps.' };
const out = rows.map((r) => {
  const [name, equipment, load_type, primary, secondary, harder, rest] = r.split('|');
  return {
    name, equipment, load_type, primary_muscle: primary,
    secondary_muscles: secondary ? secondary.split(',') : [],
    harder: harder || null,
    default_rest_sec: rest ? Number(rest) : null,
    notes: notes[name] ?? null,
  };
});
const names = new Set(out.map((e) => e.name));
for (const e of out) if (e.harder && !names.has(e.harder)) throw new Error(`Unknown harder variation ${e.harder}`);
if (names.size !== out.length) throw new Error('Duplicate names');
const fs = await import('node:fs');
fs.writeFileSync(new URL('../src/db/seed/exercises.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(out.length, 'exercises');
