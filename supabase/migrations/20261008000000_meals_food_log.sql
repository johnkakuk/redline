-- Nutrition log + saved meals (mirrors the phone's migration 007).

create table meals (
  id text not null,
  name text not null, calories bigint, protein_g double precision,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (user_id, id)
);

create table food_log (
  id text not null,
  date text, logged_at text, meal_id text, name text, servings double precision, calories bigint, protein_g double precision,
  created_at text not null, updated_at text not null, deleted_at text,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (user_id, id)
);
create index on food_log (user_id, date);

alter table meals enable row level security;
alter table food_log enable row level security;
revoke all on meals from anon, authenticated;
revoke all on food_log from anon, authenticated;

-- Same function as before, with the two new tables on the allow-list.
create or replace function sync_push(p_user uuid, p_table text, p_rows jsonb) returns integer
language plpgsql
set search_path = public
as $$
declare
  cols text;
  n integer;
begin
  if p_table not in (
    'settings', 'exercises', 'routines', 'routine_items', 'progression_state', 'progression_history',
    'workouts', 'workout_exercises', 'sets', 'body_weight', 'nutrition_day', 'meals', 'food_log'
  ) then
    raise exception 'table % is not synced', p_table;
  end if;

  select string_agg(format('%1$I = excluded.%1$I', column_name), ', ')
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table and column_name not in ('id', 'user_id');

  execute format(
    'insert into %1$I select * from jsonb_populate_recordset(null::%1$I,
       (select coalesce(jsonb_agg(r || jsonb_build_object(''user_id'', $2)), ''[]'') from jsonb_array_elements($1) r))
     on conflict (user_id, id) do update set %2$s where %1$I.updated_at < excluded.updated_at',
    p_table, cols
  ) using p_rows, p_user;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function sync_push(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function sync_push(uuid, text, jsonb) to service_role;
