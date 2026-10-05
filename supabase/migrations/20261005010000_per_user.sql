-- Accounts: every mirrored row belongs to a Supabase Auth user. Ids are unique per user, so one
-- account can never overwrite another's rows. Device pairing is replaced by Supabase Auth sessions.

drop table devices;

do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'exercises', 'routines', 'routine_items', 'progression_state', 'progression_history',
    'workouts', 'workout_exercises', 'sets', 'body_weight', 'nutrition_day'
  ] loop
    execute format('delete from %I where user_id is null', t);
    execute format('alter table %I drop constraint %I', t, t || '_pkey');
    execute format('alter table %I alter column user_id set not null', t);
    execute format('alter table %I add constraint %I foreign key (user_id) references auth.users (id) on delete cascade', t, t || '_user_fk');
    execute format('alter table %I add primary key (user_id, id)', t);
  end loop;
end $$;

alter table ai_drafts add column user_id uuid not null references auth.users (id) on delete cascade;
create index on ai_drafts (user_id, status);

-- Invite-only: emails allowed to have an account. New auth users not on the list are rejected.
create table allowed_emails (
  email text primary key check (email = lower(email)),
  note text,
  created_at timestamptz not null default now()
);
alter table allowed_emails enable row level security;
revoke all on allowed_emails from anon, authenticated;

create function enforce_invite() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.allowed_emails where email = lower(new.email)) then
    raise exception 'This email has not been invited';
  end if;
  return new;
end $$;

create trigger enforce_invite before insert on auth.users for each row execute function enforce_invite();

drop function sync_push(text, jsonb);

-- Upsert a batch of one user's rows (last-write-wins on updated_at).
create function sync_push(p_user uuid, p_table text, p_rows jsonb) returns integer
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

  -- Force user_id to the caller: rows can only ever land in the authenticated user's data.
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
