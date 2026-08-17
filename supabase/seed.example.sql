-- Pattern Manager two-user household setup template
--
-- Prerequisites:
--   1. Apply all migrations.
--   2. Invite both people from Supabase Dashboard > Authentication > Users.
--   3. Have both people accept their invitation.
--   4. Copy their Auth user UUIDs (not their emails) into the NULL values below.
--
-- This template deliberately contains no email address, password, API key,
-- access token, or production UUID. Execute the whole block as one transaction;
-- the schema checks the exact two-member composition at commit time.

begin;

do $$
declare
  -- Replace each NULL with a quoted Auth UUID, for example:
  -- v_owner_user_id uuid := '00000000-0000-0000-0000-000000000000';
  v_owner_user_id uuid := null;
  v_member_user_id uuid := null;

  -- Choose and retain a stable UUID for this household. Keeping it explicit
  -- makes this setup block safely repeatable.
  v_household_id uuid := null;

  -- Display names are not authorization inputs and may be changed later.
  v_owner_display_name text := 'Owner';
  v_member_display_name text := 'Member';
begin
  if v_owner_user_id is null
     or v_member_user_id is null
     or v_household_id is null then
    raise exception
      'Replace all three NULL UUID placeholders before running seed.example.sql';
  end if;

  if v_owner_user_id = v_member_user_id then
    raise exception 'The two Auth user UUIDs must be different';
  end if;

  if not exists (select 1 from auth.users where id = v_owner_user_id)
     or not exists (select 1 from auth.users where id = v_member_user_id) then
    raise exception 'Both UUIDs must already exist in auth.users';
  end if;

  insert into public.households (id, name)
  values (v_household_id, 'Pattern Manager Household')
  on conflict (id) do update
    set name = excluded.name;

  insert into public.household_members (household_id, user_id, role, active)
  values
    (v_household_id, v_owner_user_id, 'owner', true),
    (v_household_id, v_member_user_id, 'member', true)
  on conflict (household_id, user_id) do update
    set role = excluded.role,
        active = true;

  insert into public.profiles (user_id, household_id, display_name)
  values
    (v_owner_user_id, v_household_id, v_owner_display_name),
    (v_member_user_id, v_household_id, v_member_display_name)
  on conflict (user_id) do update
    set household_id = excluded.household_id,
        display_name = excluded.display_name;

  insert into public.user_settings (user_id, household_id, settings)
  values
    (v_owner_user_id, v_household_id, '{}'::jsonb),
    (v_member_user_id, v_household_id, '{}'::jsonb)
  on conflict (user_id) do nothing;
end;
$$;

commit;

-- This should return exactly one row with active_members=2 and active_owners=1.
select
  h.id as household_id,
  count(*) filter (where hm.active) as active_members,
  count(*) filter (where hm.active and hm.role = 'owner') as active_owners
from public.households as h
join public.household_members as hm on hm.household_id = h.id
group by h.id;
