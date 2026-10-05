-- Equipment the user owns (bodyweight is always available) and their heaviest load per type, in kg.
-- Existing installs default to owning everything so nothing disappears.
ALTER TABLE settings ADD COLUMN equipment_json TEXT NOT NULL DEFAULT '["barbell","dumbbell","kettlebell","cable","machine","band","other"]';
ALTER TABLE settings ADD COLUMN equipment_caps_json TEXT NOT NULL DEFAULT '{}';
