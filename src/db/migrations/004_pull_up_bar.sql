-- Pull-up bar becomes its own equipment type.
UPDATE exercises SET equipment = 'pull_up_bar'
 WHERE is_seeded = 1 AND equipment = 'bodyweight'
   AND name IN ('Pull-up', 'Weighted Pull-up', 'Chin-up', 'Hanging Knee Raise', 'Hanging Leg Raise');

-- Installs still on the "own everything" default get a pull-up bar too, so nothing disappears for them.
-- Anyone who picked their equipment keeps their choice and can add the bar in Settings.
UPDATE settings SET equipment_json = json_insert(equipment_json, '$[#]', 'pull_up_bar')
 WHERE (SELECT count(*) FROM json_each(equipment_json)
         WHERE value IN ('barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'band', 'other')) = 7;
