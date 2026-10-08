-- Nutrition as a log of entries (each meal or snack), plus saved meals to log in one tap.
CREATE TABLE meals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  calories INTEGER,
  protein_g REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE food_log (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,                 -- local calendar day
  logged_at TEXT NOT NULL,            -- when it was logged (ISO UTC)
  meal_id TEXT REFERENCES meals(id),  -- saved meal it came from, if any
  name TEXT,
  servings REAL NOT NULL DEFAULT 1,
  calories INTEGER,                   -- totals for this entry (already × servings)
  protein_g REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX idx_food_log_date ON food_log(date);

-- Earlier versions stored one total per day. Keep those numbers as a "Daily total" entry
-- (deterministic ids so every device converts to the same rows), then retire the old rows.
INSERT INTO food_log (id, date, logged_at, name, calories, protein_g)
  SELECT 'nd-' || id, date, date || 'T12:00:00.000Z', 'Daily total', calories, protein_g
    FROM nutrition_day WHERE deleted_at IS NULL AND (calories IS NOT NULL OR protein_g IS NOT NULL);
UPDATE nutrition_day SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE deleted_at IS NULL;
