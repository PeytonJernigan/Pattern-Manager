-- Pattern Manager production-schema validation queries
-- Read-only: every statement in this file is a SELECT.

-- 1. PASS when no row is returned: every household has exactly two active
-- members and exactly one active owner.
select
  h.id as household_id,
  count(*) filter (where hm.active) as active_members,
  count(*) filter (where hm.active and hm.role = 'owner') as active_owners
from public.households as h
left join public.household_members as hm on hm.household_id = h.id
group by h.id
having count(*) filter (where hm.active) <> 2
    or count(*) filter (where hm.active and hm.role = 'owner') <> 1;

-- 2. PASS when all 18 rows report rowsecurity=true.
select
  c.relname as table_name,
  c.relrowsecurity as rowsecurity,
  c.relforcerowsecurity as force_rowsecurity
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = any (array[
    'households', 'household_members', 'profiles', 'user_settings',
    'import_batches', 'assets', 'patterns', 'favorites', 'pattern_assets',
    'projects', 'project_tasks', 'project_notes', 'project_counters',
    'counter_mutations', 'pdf_annotations', 'pdf_sessions', 'activity_log',
    'import_rows'
  ])
order by c.relname;

-- 3. PASS when no rows are returned: anon has no Pattern Manager table grants.
select table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema = 'public'
  and table_name = any (array[
    'households', 'household_members', 'profiles', 'user_settings',
    'import_batches', 'assets', 'patterns', 'favorites', 'pattern_assets',
    'projects', 'project_tasks', 'project_notes', 'project_counters',
    'counter_mutations', 'pdf_annotations', 'pdf_sessions', 'activity_log',
    'import_rows'
  ]);

-- 4. PASS when both rows report public=false and show the intended restrictions.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('pattern-assets', 'project-media')
order by id;

-- 5. PASS when every object name starts with its owner household UUID.
select o.bucket_id, o.name
from storage.objects as o
where o.bucket_id in ('pattern-assets', 'project-media')
  and not exists (
    select 1
    from public.households as h
    where (storage.foldername(o.name))[1] = h.id::text
  );

-- 6. PASS when no row is returned: project-media follows the enforced path
-- <household>/projects/<project_uuid>/<filename> and references a real project.
select o.name
from storage.objects as o
where o.bucket_id = 'project-media'
  and (
    (storage.foldername(o.name))[2] is distinct from 'projects'
    or private.safe_uuid((storage.foldername(o.name))[3]) is null
    or not exists (
      select 1
      from public.projects as p
      where p.id = private.safe_uuid((storage.foldername(o.name))[3])
        and p.household_id::text = (storage.foldername(o.name))[1]
    )
  );

-- 7. PASS when no row is returned: every project-media metadata row encodes
-- a real same-household project. RLS derives private-project visibility from
-- this path.
select a.id, a.household_id, a.storage_path
from public.assets as a
where a.storage_bucket = 'project-media'
  and (
    split_part(a.storage_path, '/', 2) is distinct from 'projects'
    or private.safe_uuid(split_part(a.storage_path, '/', 3)) is null
    or not exists (
      select 1
      from public.projects as p
      where p.id = private.safe_uuid(split_part(a.storage_path, '/', 3))
        and p.household_id = a.household_id
    )
  );

-- 8. PASS when no row is returned: the denormalized primary pointer and the
-- primary junction row agree, including role and null state.
select p.id, p.external_id, p.primary_asset_id
from public.patterns as p
where not (
  (
    p.primary_asset_id is null
    and not exists (
      select 1
      from public.pattern_assets as pa
      where pa.household_id = p.household_id
        and pa.pattern_id = p.id
        and pa.is_primary
    )
  )
  or
  (
    p.primary_asset_id is not null
    and exists (
      select 1
      from public.pattern_assets as pa
      join public.assets as a
        on a.id = pa.asset_id
       and a.household_id = pa.household_id
      where pa.household_id = p.household_id
        and pa.pattern_id = p.id
        and pa.asset_id = p.primary_asset_id
        and pa.role = 'primary_instructions'
        and pa.is_primary
        and a.storage_bucket = 'pattern-assets'
    )
  )
);

-- 9. PASS when no row is returned: annotation rectangles and optional
-- freehand points use numeric normalized page units.
select id, page_number, geometry
from public.pdf_annotations
where not private.is_normalized_annotation_geometry(geometry);

-- 10. PASS when no row is returned: counter mutation results still correspond
-- to a real same-household counter. Foreign keys should make this impossible.
select cm.id, cm.counter_id
from public.counter_mutations as cm
left join public.project_counters as pc
  on pc.id = cm.counter_id and pc.household_id = cm.household_id
where pc.id is null;

-- 11. Import reconciliation by batch. failed/conflict counts should be reviewed.
select
  b.id,
  b.source_key,
  b.status,
  count(r.id) as row_count,
  count(r.id) filter (where r.status = 'inserted') as inserted_count,
  count(r.id) filter (where r.status = 'updated') as updated_count,
  count(r.id) filter (where r.status = 'skipped') as skipped_count,
  count(r.id) filter (where r.status = 'conflict') as conflict_count,
  count(r.id) filter (where r.status = 'failed') as failed_count
from public.import_batches as b
left join public.import_rows as r
  on r.batch_id = b.id and r.household_id = b.household_id
group by b.id, b.source_key, b.status
order by b.created_at desc;

-- 12. Function exposure: anon must not execute either elevated RPC;
-- authenticated must be able to execute both.
select
  has_function_privilege(
    'anon',
    'public.increment_project_counter(uuid,integer,uuid)',
    'execute'
  ) as anon_can_increment,
  has_function_privilege(
    'authenticated',
    'public.increment_project_counter(uuid,integer,uuid)',
    'execute'
  ) as authenticated_can_increment,
  has_function_privilege(
    'anon',
    'public.set_pattern_primary_asset(uuid,uuid)',
    'execute'
  ) as anon_can_set_primary,
  has_function_privilege(
    'authenticated',
    'public.set_pattern_primary_asset(uuid,uuid)',
    'execute'
  ) as authenticated_can_set_primary;

-- 13. Private helpers must not be included in an exposed PostgREST schema.
-- Check Dashboard > Project Settings > API and verify exposed schemas do not
-- contain "private". This query lists the helpers expected in that schema.
select routine_schema, routine_name, security_type
from information_schema.routines
where routine_schema = 'private'
order by routine_name;

-- 14. PASS when no row is returned: the four client-write guards exist and
-- are enabled. They protect immutable asset identity, coupled primary-file
-- state, and counter arithmetic while leaving ordinary metadata editable.
with expected (table_name, trigger_name) as (
  values
    ('assets', 'assets_protect_identity'),
    ('patterns', 'patterns_protect_primary_asset'),
    ('pattern_assets', 'pattern_assets_protect_primary_link'),
    ('project_counters', 'project_counters_protect_values')
)
select e.table_name, e.trigger_name
from expected as e
left join pg_class as c
  on c.relname = e.table_name
left join pg_namespace as n
  on n.oid = c.relnamespace
 and n.nspname = 'public'
left join pg_trigger as t
  on t.tgrelid = c.oid
 and n.oid is not null
 and t.tgname = e.trigger_name
 and not t.tgisinternal
where t.oid is null or t.tgenabled = 'D';

-- 15. PASS when no row is returned: authenticated clients cannot delete asset
-- metadata directly. Trusted service-role maintenance bypasses RLS separately.
select 'table_grant' as exposure_type, privilege_type as detail
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_schema = 'public'
  and table_name = 'assets'
  and privilege_type = 'DELETE'
union all
select 'rls_policy' as exposure_type, policyname as detail
from pg_policies
where schemaname = 'public'
  and tablename = 'assets'
  and cmd = 'DELETE'
  and 'authenticated' = any (roles);

-- 16. PASS when no row is returned: Storage is append-only for authenticated
-- clients. INSERT and SELECT policies remain; object overwrite/move/delete is
-- reserved for trusted administrative maintenance.
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and cmd in ('UPDATE', 'DELETE')
  and 'authenticated' = any (roles);
