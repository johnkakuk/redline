-- Cloud mirror of the on-device SQLite schema (PLAN §10).
-- Same table and column names as the phone. Timestamps stay ISO text so rows round-trip exactly
-- and last-write-wins compares the same strings the phone writes. JSON columns are jsonb.
-- Only the Cloudflare Worker (service role) touches this database: RLS is on with no policies.

create table settings (
  id text primary key,
  units text, sex text, birth_date text, height_cm double precision,
  default_rest_sec bigint, calorie_intensity text, protein_target_g bigint, calorie_target bigint,
  weekly_target bigint, default_increment_json jsonb, onboarded bigint, last_export_at text,
  equipment_json jsonb, equipment_caps_json jsonb,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid
);

create table exercises (
  id text primary key,
  name text not null, primary_muscle text, secondary_muscles jsonb, equipment text, load_type text,
  default_increment_kg double precision, max_load_kg double precision,
  harder_variation_id text, easier_variation_id text, default_rest_sec bigint,
  notes text, is_seeded bigint, archived bigint,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid
);

create table routines (
  id text primary key,
  name text not null, notes text, sort_order bigint, archived bigint,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid
);

create table routine_items (
  id text primary key,
  routine_id text, exercise_id text, sort_order bigint, group_id text,
  working_sets bigint, rep_min bigint, rep_max bigint, warmup_sets bigint, rest_sec bigint,
  progression_mode text, increment_kg double precision, max_load_kg double precision, notes text,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid
);

create table progression_state (
  id text primary key,
  routine_item_id text, target_weight_kg double precision, target_reps_json jsonb, status text,
  fail_streak bigint, pinned bigint, prompt_weight_kg double precision, snooze bigint, last_evaluated_workout_id text,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid
);

create table progression_history (
  id text primary key,
  routine_item_id text, workout_id text, kind text, reason text, before_json jsonb, after_json jsonb, undone bigint,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid
);

create table workouts (
  id text primary key,
  routine_id text, name text, started_at text, ended_at text, active_duration_sec bigint,
  bodyweight_kg double precision, kcal_estimate double precision, notes text, status text,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid
);

create table workout_exercises (
  id text primary key,
  workout_id text, exercise_id text, routine_item_id text, sort_order bigint, group_id text, notes text,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid
);

create table sets (
  id text primary key,
  workout_exercise_id text, sort_order bigint, kind text, weight_kg double precision, reps bigint,
  suggested_weight_kg double precision, suggested_reps bigint, overridden bigint, completed_at text,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid
);

create table body_weight (
  id text primary key,
  date text, weight_kg double precision, note text,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid
);

create table nutrition_day (
  id text primary key,
  date text, calories bigint, protein_g bigint,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid
);

create index on routine_items (routine_id);
create index on workout_exercises (workout_id);
create index on workout_exercises (exercise_id);
create index on sets (workout_exercise_id);
create index on workouts (started_at);
create index on body_weight (date);

-- Paired devices. Tokens are stored as SHA-256 hashes only.
create table devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

-- AI inbox (PLAN §10): drafts written by the MCP connector, reviewed in the app.
create table ai_drafts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('routine', 'exercise', 'routine_update', 'program')),
  payload jsonb not null,
  source text not null,
  summary text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index on ai_drafts (status, created_at);

do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'exercises', 'routines', 'routine_items', 'progression_state', 'progression_history',
    'workouts', 'workout_exercises', 'sets', 'body_weight', 'nutrition_day', 'devices', 'ai_drafts'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- Upsert a batch of rows for one mirrored table. A row is only overwritten when the incoming
-- updated_at is newer (last-write-wins), so re-sending a batch is harmless.
create function sync_push(p_table text, p_rows jsonb) returns integer
language plpgsql
set search_path = public
as $$
declare
  cols text;
  n integer;
begin
  if p_table not in (
    'settings', 'exercises', 'routines', 'routine_items', 'progression_state', 'progression_history',
    'workouts', 'workout_exercises', 'sets', 'body_weight', 'nutrition_day'
  ) then
    raise exception 'table % is not synced', p_table;
  end if;

  select string_agg(format('%1$I = excluded.%1$I', column_name), ', ')
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table and column_name not in ('id', 'user_id');

  execute format(
    'insert into %1$I select * from jsonb_populate_recordset(null::%1$I, $1)
     on conflict (id) do update set %2$s where %1$I.updated_at < excluded.updated_at',
    p_table, cols
  ) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function sync_push(text, jsonb) from public, anon, authenticated;
grant execute on function sync_push(text, jsonb) to service_role;
