-- Pattern Manager: initial production schema
--
-- Security model:
--   * Supabase Auth owns identities in auth.users.
--   * Each Auth user may belong to exactly one household.
--   * A household can have at most two active members.
--   * Public Data API tables use RLS; anon receives no table privileges.
--   * Pattern files and project media live in private Storage buckets.
--
-- This migration intentionally contains no email address, API key, password,
-- signed URL, or user UUID. Run seed.example.sql only after the two Auth users
-- have accepted their invitations.

begin;

create extension if not exists pgcrypto;

create schema if not exists private;
comment on schema private is
  'Non-exposed helper functions used by Pattern Manager RLS policies and triggers.';
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Household and identity-facing records
-- ---------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  member_limit smallint not null default 2 check (member_limit = 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.households is
  'The private two-person workspace. member_limit is fixed at two by design.';

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

comment on table public.household_members is
  'Server-managed allowlist connecting the only two permitted Auth users to the household.';
comment on column public.household_members.active is
  'Inactive rows immediately fail current_household_id() and therefore all application RLS policies.';

create or replace function private.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hm.household_id
  from public.household_members as hm
  where hm.user_id = (select auth.uid())
    and hm.active
  limit 1
$$;

comment on function private.current_household_id() is
  'Returns the caller active household, or NULL for anonymous, inactive, or unlisted users.';
revoke all on function private.current_household_id() from public;
grant execute on function private.current_household_id() to authenticated;

create or replace function private.current_household_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select hm.role
  from public.household_members as hm
  where hm.user_id = (select auth.uid())
    and hm.active
  limit 1
$$;

revoke all on function private.current_household_role() from public;
grant execute on function private.current_household_role() to authenticated;

create or replace function private.enforce_two_active_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit smallint;
  v_active_count integer;
begin
  if not new.active then
    return new;
  end if;

  -- Serialize membership changes for a household so concurrent inserts cannot
  -- both pass the capacity check.
  select h.member_limit
    into v_limit
  from public.households as h
  where h.id = new.household_id
  for update;

  if v_limit is null then
    raise exception 'Household % does not exist', new.household_id
      using errcode = '23503';
  end if;

  select count(*)::integer
    into v_active_count
  from public.household_members as hm
  where hm.household_id = new.household_id
    and hm.active
    and hm.user_id <> new.user_id;

  if v_active_count >= v_limit then
    raise exception 'Household % already has its two active members', new.household_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_two_active_members() from public;

create trigger household_members_enforce_capacity
before insert or update of household_id, user_id, active
on public.household_members
for each row execute function private.enforce_two_active_members();

create or replace function private.protect_membership_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_id <> old.household_id or new.user_id <> old.user_id then
    raise exception 'Membership household_id and user_id are immutable; replace the row in one transaction'
      using errcode = '22000';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_membership_identity() from public;

create trigger household_members_protect_identity
before update on public.household_members
for each row execute function private.protect_membership_identity();

create or replace function private.enforce_household_composition_at_commit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_active_count integer;
  v_owner_count integer;
begin
  if tg_table_name = 'households' then
    v_household_id := new.id;
  elsif tg_op = 'DELETE' then
    v_household_id := old.household_id;
  else
    v_household_id := new.household_id;
  end if;

  -- Cascading membership deletes after a household delete need no check.
  if not exists (
    select 1 from public.households as h where h.id = v_household_id
  ) then
    return null;
  end if;

  select count(*)::integer,
         count(*) filter (where hm.role = 'owner')::integer
    into v_active_count, v_owner_count
  from public.household_members as hm
  where hm.household_id = v_household_id
    and hm.active;

  if v_active_count <> 2 or v_owner_count <> 1 then
    raise exception
      'Household % must finish each transaction with exactly two active members and one owner (found % active, % owners)',
      v_household_id, v_active_count, v_owner_count
      using errcode = '23514';
  end if;

  return null;
end;
$$;

comment on function private.enforce_household_composition_at_commit() is
  'Deferred exact-two-user invariant; provision or replace both memberships within one transaction.';
revoke all on function private.enforce_household_composition_at_commit() from public;

create constraint trigger households_require_two_members
after insert or update on public.households
deferrable initially deferred
for each row execute function private.enforce_household_composition_at_commit();

create constraint trigger household_members_require_exact_composition
after insert or update or delete on public.household_members
deferrable initially deferred
for each row execute function private.enforce_household_composition_at_commit();

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null default private.current_household_id(),
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  avatar_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, user_id)
    references public.household_members(household_id, user_id) on delete restrict
);

comment on table public.profiles is
  'Public-within-the-household display data. Auth emails are never copied here.';

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null default private.current_household_id(),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, user_id)
    references public.household_members(household_id, user_id) on delete restrict
);

comment on table public.user_settings is
  'Per-user preferences that follow the user across browsers and devices.';

-- ---------------------------------------------------------------------------
-- Import batches are defined before patterns so imported rows can retain
-- provenance without embedding private local filesystem paths.
-- ---------------------------------------------------------------------------

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.current_household_id()
    references public.households(id) on delete cascade,
  source_key text not null check (length(btrim(source_key)) between 1 and 120),
  source_label text not null check (length(btrim(source_label)) between 1 and 240),
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'completed_with_errors', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  unique (household_id, source_key, manifest_sha256)
);

comment on table public.import_batches is
  'Auditable catalog-import runs. source_key is a stable alias, never an absolute local path.';

-- ---------------------------------------------------------------------------
-- Catalog assets and patterns
-- ---------------------------------------------------------------------------

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.current_household_id()
    references public.households(id) on delete cascade,
  storage_bucket text not null default 'pattern-assets'
    check (storage_bucket in ('pattern-assets', 'project-media')),
  storage_path text not null check (
    length(btrim(storage_path)) > 0
    and storage_path like household_id::text || '/%'
  ),
  original_name text not null check (length(btrim(original_name)) > 0),
  mime_type text not null,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  page_count integer check (page_count is null or page_count > 0),
  version integer not null default 1 check (version > 0),
  language text,
  role text not null default 'supporting_file',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    storage_bucket = 'pattern-assets'
    or (
      split_part(storage_path, '/', 2) = 'projects'
      and split_part(storage_path, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and split_part(storage_path, '/', 4) <> ''
    )
  ),
  unique (household_id, id),
  unique (storage_bucket, storage_path),
  unique (household_id, sha256)
);

comment on table public.assets is
  'Metadata for private Storage objects. storage_path is relative and never a signed URL.';
comment on column public.assets.sha256 is
  'Lowercase SHA-256 used to deduplicate identical files without relying on titles.';
comment on column public.assets.storage_path is
  'Household-prefixed object key. project-media keys must encode /projects/<project_uuid>/ for privacy RLS.';

create table public.patterns (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.current_household_id()
    references public.households(id) on delete cascade,
  external_id text,
  catalog_code text,
  title text not null check (length(btrim(title)) between 1 and 300),
  craft text not null check (length(btrim(craft)) between 1 and 80),
  category text,
  item_type text,
  item_subtype text,
  designer_name text,
  publisher text,
  description text,
  thumbnail_storage_path text,
  primary_asset_id uuid,
  source_url text,
  skill_level text,
  yarn_weight text,
  size_summary text,
  free_status text not null default 'Unknown',
  access_status text not null default 'Unknown',
  tags text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source_managed boolean not null default false,
  source_updated_at timestamptz,
  user_modified_at timestamptz,
  import_batch_id uuid,
  import_fingerprint text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (household_id, id),
  foreign key (household_id, primary_asset_id)
    references public.assets(household_id, id) on delete restrict,
  foreign key (household_id, import_batch_id)
    references public.import_batches(household_id, id) on delete restrict
);

comment on table public.patterns is
  'Human-editable pattern catalog. Stable PAT identifiers belong in external_id or catalog_code.';
comment on column public.patterns.source_managed is
  'True for importer-owned records; user_modified_at lets an importer avoid overwriting human edits.';
comment on column public.patterns.metadata is
  'Extended catalog metadata. Frequently filtered fields remain first-class columns.';

create unique index patterns_external_id_unique_idx
  on public.patterns (household_id, external_id)
  where external_id is not null;

create unique index patterns_catalog_code_unique_idx
  on public.patterns (household_id, catalog_code)
  where catalog_code is not null;

create index patterns_household_title_idx
  on public.patterns (household_id, title)
  where deleted_at is null;

create index patterns_tags_gin_idx on public.patterns using gin (tags);
create index patterns_metadata_gin_idx on public.patterns using gin (metadata);

create table public.favorites (
  household_id uuid not null default private.current_household_id(),
  user_id uuid not null default auth.uid(),
  pattern_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, pattern_id),
  foreign key (household_id, user_id)
    references public.household_members(household_id, user_id) on delete cascade,
  foreign key (household_id, pattern_id)
    references public.patterns(household_id, id) on delete cascade
);

comment on table public.favorites is
  'Private per-user favorites; spouses do not overwrite one another selections.';

create table public.pattern_assets (
  household_id uuid not null default private.current_household_id(),
  pattern_id uuid not null,
  asset_id uuid not null,
  role text not null default 'supporting_file',
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (pattern_id, asset_id),
  foreign key (household_id, pattern_id)
    references public.patterns(household_id, id) on delete cascade,
  foreign key (household_id, asset_id)
    references public.assets(household_id, id) on delete cascade
);

comment on table public.pattern_assets is
  'Many-to-many relationship between canonical patterns and deduplicated private files.';

create unique index pattern_assets_one_primary_idx
  on public.pattern_assets (pattern_id)
  where is_primary;

-- ---------------------------------------------------------------------------
-- General creative-project tracker
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.current_household_id()
    references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid(),
  owner_user_id uuid not null default auth.uid(),
  pattern_id uuid,
  title text not null check (length(btrim(title)) between 1 and 300),
  project_kind text not null check (length(btrim(project_kind)) between 1 and 80),
  status text not null default 'planned'
    check (status in ('idea', 'planned', 'in_progress', 'paused', 'complete', 'abandoned', 'archived')),
  visibility text not null default 'household'
    check (visibility in ('private', 'household')),
  progress_percent numeric(5,2) not null default 0
    check (progress_percent between 0 and 100),
  current_section text,
  size_label text,
  colorway text,
  notes text,
  cover_storage_path text,
  external_url text,
  started_on date,
  due_on date,
  completed_on date,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (household_id, id),
  foreign key (household_id, created_by)
    references public.household_members(household_id, user_id) on delete restrict,
  foreign key (household_id, owner_user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  foreign key (household_id, pattern_id)
    references public.patterns(household_id, id) on delete restrict
);

comment on table public.projects is
  'Tracks fiber and non-fiber creative work. pattern_id is optional and external_url can link another tool.';
comment on column public.projects.visibility is
  'household is shared with both members; private is visible only to creator and owner.';

create index projects_household_status_idx
  on public.projects (household_id, status, updated_at desc)
  where deleted_at is null;

create or replace function private.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as p
    where p.id = p_project_id
      and p.household_id = private.current_household_id()
      and p.deleted_at is null
      and (
        p.visibility = 'household'
        or p.owner_user_id = (select auth.uid())
        or p.created_by = (select auth.uid())
      )
  )
$$;

comment on function private.can_access_project(uuid) is
  'Central project visibility check reused by project-child and Storage RLS policies.';
revoke all on function private.can_access_project(uuid) from public;
grant execute on function private.can_access_project(uuid) to authenticated;

create or replace function private.safe_uuid(p_value text)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  return p_value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all on function private.safe_uuid(text) from public;
grant execute on function private.safe_uuid(text) to authenticated;

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.current_household_id(),
  project_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 300),
  completed boolean not null default false,
  position integer not null default 0,
  due_date date,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, project_id)
    references public.projects(household_id, id) on delete cascade,
  foreign key (household_id, created_by)
    references public.household_members(household_id, user_id) on delete restrict
);

create index project_tasks_project_position_idx
  on public.project_tasks (project_id, completed, position);

create table public.project_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.current_household_id(),
  project_id uuid not null,
  author_id uuid not null default auth.uid(),
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (household_id, project_id)
    references public.projects(household_id, id) on delete cascade,
  foreign key (household_id, author_id)
    references public.household_members(household_id, user_id) on delete restrict
);

create index project_notes_project_created_idx
  on public.project_notes (project_id, created_at desc)
  where deleted_at is null;

create table public.project_counters (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.current_household_id(),
  project_id uuid not null,
  user_id uuid not null default auth.uid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  current_value integer not null default 0 check (current_value >= 0),
  step integer not null default 1 check (step <> 0),
  target_value integer check (target_value is null or target_value >= 0),
  repeat_length integer check (repeat_length is null or repeat_length > 0),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  unique (household_id, project_id, id),
  foreign key (household_id, project_id)
    references public.projects(household_id, id) on delete cascade,
  foreign key (household_id, user_id)
    references public.household_members(household_id, user_id) on delete restrict
);

comment on table public.project_counters is
  'Named row, round, repeat, or step counters attached to a project.';

create index project_counters_project_idx
  on public.project_counters (project_id, created_at);

create table public.counter_mutations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  counter_id uuid not null,
  user_id uuid not null,
  client_mutation_id uuid not null,
  delta integer not null,
  result_value integer not null check (result_value >= 0),
  result_revision integer not null check (result_revision > 0),
  created_at timestamptz not null default now(),
  foreign key (household_id, counter_id)
    references public.project_counters(household_id, id) on delete cascade,
  foreign key (household_id, user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  unique (user_id, client_mutation_id)
);

comment on table public.counter_mutations is
  'Immutable idempotency ledger for offline-safe counter increments. Only the counter RPC writes it.';

-- ---------------------------------------------------------------------------
-- PDF reader state and normalized application-owned annotations
-- ---------------------------------------------------------------------------

create or replace function private.is_normalized_annotation_geometry(p_geometry jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_key text;
  v_value numeric;
  v_point jsonb;
begin
  if jsonb_typeof(p_geometry) <> 'object' then
    return false;
  end if;

  foreach v_key in array array['x', 'y', 'width', 'height'] loop
    if jsonb_typeof(p_geometry -> v_key) <> 'number' then
      return false;
    end if;
    v_value := (p_geometry ->> v_key)::numeric;
    if v_value < 0 or v_value > 1 then
      return false;
    end if;
  end loop;

  -- Freehand annotations may carry normalized point coordinates in addition
  -- to their bounding rectangle.
  if p_geometry ? 'points' then
    if jsonb_typeof(p_geometry -> 'points') <> 'array' then
      return false;
    end if;
    for v_point in select value from jsonb_array_elements(p_geometry -> 'points') loop
      if jsonb_typeof(v_point) <> 'object'
         or jsonb_typeof(v_point -> 'x') <> 'number'
         or jsonb_typeof(v_point -> 'y') <> 'number'
         or (v_point ->> 'x')::numeric < 0
         or (v_point ->> 'x')::numeric > 1
         or (v_point ->> 'y')::numeric < 0
         or (v_point ->> 'y')::numeric > 1 then
        return false;
      end if;
    end loop;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

comment on function private.is_normalized_annotation_geometry(jsonb) is
  'Validates application-owned PDF overlay rectangles and optional freehand points in normalized page units.';
revoke all on function private.is_normalized_annotation_geometry(jsonb) from public;
grant execute on function private.is_normalized_annotation_geometry(jsonb) to authenticated, service_role;

create table public.pdf_annotations (
  id uuid primary key,
  household_id uuid not null default private.current_household_id(),
  project_id uuid not null,
  asset_id uuid not null,
  author_user_id uuid not null default auth.uid(),
  client_mutation_id uuid not null,
  page_number integer not null check (page_number > 0),
  kind text not null
    check (kind in ('pen', 'highlight', 'line', 'rectangle', 'note', 'sticker', 'row_guide', 'check')),
  geometry jsonb not null check (private.is_normalized_annotation_geometry(geometry)),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  style jsonb not null default '{}'::jsonb check (jsonb_typeof(style) = 'object'),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (household_id, project_id)
    references public.projects(household_id, id) on delete cascade,
  foreign key (household_id, asset_id)
    references public.assets(household_id, id) on delete cascade,
  foreign key (household_id, author_user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  unique (author_user_id, client_mutation_id)
);

comment on table public.pdf_annotations is
  'Normalized 0..1 overlay coordinates and mark data. Canonical PDFs remain immutable.';
comment on column public.pdf_annotations.geometry is
  'Coordinates are relative to the unrotated PDF page, independent of zoom and display pixels.';

create index pdf_annotations_reader_idx
  on public.pdf_annotations (project_id, asset_id, page_number, created_at)
  where deleted_at is null;

create table public.pdf_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.current_household_id(),
  project_id uuid not null,
  asset_id uuid not null,
  user_id uuid not null default auth.uid(),
  current_page integer not null default 1 check (current_page > 0),
  zoom numeric(8,4) not null default 1 check (zoom between 0.1 and 10),
  fit_mode text not null default 'width' check (fit_mode in ('width', 'page', 'custom')),
  scroll_offset numeric not null default 0 check (scroll_offset >= 0),
  selected_counter_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, project_id)
    references public.projects(household_id, id) on delete cascade,
  foreign key (household_id, asset_id)
    references public.assets(household_id, id) on delete cascade,
  foreign key (household_id, user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  foreign key (household_id, project_id, selected_counter_id)
    references public.project_counters(household_id, project_id, id) on delete restrict,
  unique (user_id, project_id, asset_id)
);

comment on table public.pdf_sessions is
  'Per-user reader location and zoom; one spouse session never overwrites the other.';

-- ---------------------------------------------------------------------------
-- Household activity feed and import row results
-- ---------------------------------------------------------------------------

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.current_household_id()
    references public.households(id) on delete cascade,
  actor_user_id uuid default auth.uid() references auth.users(id) on delete set null,
  project_id uuid,
  pattern_id uuid,
  entity_type text not null check (length(btrim(entity_type)) between 1 and 80),
  entity_id uuid,
  action text not null check (length(btrim(action)) between 1 and 120),
  summary text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (household_id, project_id)
    references public.projects(household_id, id) on delete cascade,
  foreign key (household_id, pattern_id)
    references public.patterns(household_id, id) on delete cascade
);

comment on table public.activity_log is
  'Human-facing collaboration feed, not a tamper-proof security audit log.';

create index activity_log_household_created_idx
  on public.activity_log (household_id, created_at desc);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  batch_id uuid not null,
  row_number integer not null check (row_number > 0),
  entity_type text not null check (entity_type in ('pattern', 'asset', 'pattern_asset', 'creator', 'other')),
  external_id text,
  source_fingerprint text,
  status text not null
    check (status in ('inserted', 'updated', 'skipped', 'conflict', 'failed')),
  pattern_id uuid,
  asset_id uuid,
  message text,
  source_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(source_payload) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (household_id, batch_id)
    references public.import_batches(household_id, id) on delete cascade,
  foreign key (household_id, pattern_id)
    references public.patterns(household_id, id) on delete restrict,
  foreign key (household_id, asset_id)
    references public.assets(household_id, id) on delete restrict,
  unique (batch_id, row_number)
);

comment on table public.import_rows is
  'Per-record result ledger used to reconcile imports and surface non-destructive conflicts.';

create index import_rows_batch_status_idx
  on public.import_rows (batch_id, status, row_number);

-- ---------------------------------------------------------------------------
-- Timestamps, human-edit protection, and lightweight activity events
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;

create trigger households_set_updated_at
before update on public.households
for each row execute function private.set_updated_at();

create trigger household_members_set_updated_at
before update on public.household_members
for each row execute function private.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute function private.set_updated_at();

create trigger import_batches_set_updated_at
before update on public.import_batches
for each row execute function private.set_updated_at();

create trigger assets_set_updated_at
before update on public.assets
for each row execute function private.set_updated_at();

create trigger patterns_set_updated_at
before update on public.patterns
for each row execute function private.set_updated_at();

create trigger projects_set_updated_at
before update on public.projects
for each row execute function private.set_updated_at();

create trigger project_tasks_set_updated_at
before update on public.project_tasks
for each row execute function private.set_updated_at();

create trigger project_notes_set_updated_at
before update on public.project_notes
for each row execute function private.set_updated_at();

create trigger project_counters_set_updated_at
before update on public.project_counters
for each row execute function private.set_updated_at();

create trigger pdf_annotations_set_updated_at
before update on public.pdf_annotations
for each row execute function private.set_updated_at();

create trigger pdf_sessions_set_updated_at
before update on public.pdf_sessions
for each row execute function private.set_updated_at();

create or replace function private.mark_pattern_user_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.updated_by := (select auth.uid());
    new.user_modified_at := now();
  end if;
  return new;
end;
$$;

comment on function private.mark_pattern_user_edit() is
  'Marks browser-authenticated pattern edits so later source imports can preserve human work.';
revoke all on function private.mark_pattern_user_edit() from public;

create trigger patterns_mark_user_edit
before update on public.patterns
for each row execute function private.mark_pattern_user_edit();

create or replace function private.protect_asset_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Trusted imports and administrative maintenance have no end-user JWT.
  if (select auth.uid()) is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Browser asset deletion is disabled; retain the immutable original'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.household_id is distinct from old.household_id
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path
     or new.sha256 is distinct from old.sha256
     or new.byte_size is distinct from old.byte_size
     or new.mime_type is distinct from old.mime_type
     or new.original_name is distinct from old.original_name
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.deleted_at is distinct from old.deleted_at then
    raise exception 'Asset identity and original-file provenance are immutable for authenticated clients'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function private.protect_asset_identity() is
  'Keeps browser-created asset originals append-only while permitting extracted metadata maintenance.';
revoke all on function private.protect_asset_identity() from public;

create trigger assets_protect_identity
before update or delete on public.assets
for each row execute function private.protect_asset_identity();

create or replace function private.protect_pattern_primary_asset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Imports and administrative SQL have no end-user JWT. The atomic RPC sets
  -- a transaction-local capability only while it updates both representations.
  if (select auth.uid()) is null
     or (
       coalesce(current_setting('pattern_manager.primary_asset_rpc', true), '') = 'on'
       and current_user = (
         select pg_catalog.pg_get_userbyid(p.proowner)
         from pg_catalog.pg_proc as p
         where p.oid = pg_catalog.to_regprocedure(
           'public.set_pattern_primary_asset(uuid,uuid)'
         )
       )
     ) then
    return new;
  end if;

  if tg_op = 'INSERT' and new.primary_asset_id is not null then
    raise exception 'Set a new pattern primary asset with set_pattern_primary_asset()'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and new.primary_asset_id is distinct from old.primary_asset_id then
    raise exception 'Replace a pattern primary asset with set_pattern_primary_asset()'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function private.protect_pattern_primary_asset() is
  'Prevents authenticated clients from changing the denormalized primary pointer outside its atomic RPC.';
revoke all on function private.protect_pattern_primary_asset() from public;

create trigger patterns_protect_primary_asset
before insert or update on public.patterns
for each row execute function private.protect_pattern_primary_asset();

create or replace function private.protect_pattern_asset_primary_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or (
       coalesce(current_setting('pattern_manager.primary_asset_rpc', true), '') = 'on'
       and current_user = (
         select pg_catalog.pg_get_userbyid(p.proowner)
         from pg_catalog.pg_proc as p
         where p.oid = pg_catalog.to_regprocedure(
           'public.set_pattern_primary_asset(uuid,uuid)'
         )
       )
     ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' and new.is_primary then
    raise exception 'Create a primary pattern link with set_pattern_primary_asset()'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (old.is_primary or new.is_primary) then
    raise exception 'Change a primary pattern link with set_pattern_primary_asset()'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' and old.is_primary then
    -- A foreign-key cascade deleting the entire parent pattern preserves the
    -- invariant because the pointer and relationship disappear together.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'Remove a primary pattern link by replacing or deleting its pattern'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function private.protect_pattern_asset_primary_link() is
  'Protects primary pattern junction rows while allowing ordinary non-primary file-link maintenance.';
revoke all on function private.protect_pattern_asset_primary_link() from public;

create trigger pattern_assets_protect_primary_link
before insert or update or delete on public.pattern_assets
for each row execute function private.protect_pattern_asset_primary_link();

create or replace function private.protect_project_counter_values()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or (
       coalesce(current_setting('pattern_manager.counter_rpc', true), '') = 'on'
       and current_user = (
         select pg_catalog.pg_get_userbyid(p.proowner)
         from pg_catalog.pg_proc as p
         where p.oid = pg_catalog.to_regprocedure(
           'public.increment_project_counter(uuid,integer,uuid)'
         )
       )
     ) then
    return new;
  end if;

  if tg_op = 'INSERT'
     and (new.current_value <> 0 or new.revision <> 1) then
    raise exception 'New counters must start at value 0 and revision 1'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and (
       new.current_value is distinct from old.current_value
       or new.revision is distinct from old.revision
     ) then
    raise exception 'Change counter values with increment_project_counter()'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function private.protect_project_counter_values() is
  'Allows normal counter metadata edits but reserves value and revision arithmetic for the idempotent RPC.';
revoke all on function private.protect_project_counter_values() from public;

create trigger project_counters_protect_values
before insert or update on public.project_counters
for each row execute function private.protect_project_counter_values();

create or replace function private.protect_project_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.household_id <> old.household_id
     or new.created_by <> old.created_by then
    raise exception 'Project identity fields are immutable'
      using errcode = '22000';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_project_identity() from public;

create trigger projects_protect_identity
before update on public.projects
for each row execute function private.protect_project_identity();

create or replace function private.protect_annotation_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.household_id <> old.household_id
     or new.project_id <> old.project_id
     or new.asset_id <> old.asset_id
     or new.author_user_id <> old.author_user_id
     or new.created_at <> old.created_at then
    raise exception 'Annotation identity fields are immutable'
      using errcode = '22000';
  end if;

  -- An exact retry of an already-applied upsert is an idempotent no-op.
  if new.client_mutation_id = old.client_mutation_id
     and new.revision = old.revision
     and new.geometry = old.geometry
     and new.content = old.content
     and new.style = old.style
     and new.deleted_at is not distinct from old.deleted_at then
    return null;
  end if;

  -- The current browser outbox retries a tombstone update without sending a
  -- replacement revision. Promote the first such delete exactly once; later
  -- retries are no-ops even if they carry a newly generated timestamp.
  if new.deleted_at is not null and new.revision = old.revision then
    if old.deleted_at is not null then
      return null;
    end if;
    new.revision := old.revision + 1;
  end if;

  if new.revision <> old.revision + 1 then
    raise exception 'Annotation revision conflict: expected %, received %',
      old.revision + 1, new.revision
      using errcode = '40001';
  end if;

  return new;
end;
$$;

comment on function private.protect_annotation_update() is
  'Optimistic concurrency guard for synced PDF overlays; repeated identical mutations are safe.';
revoke all on function private.protect_annotation_update() from public;

create trigger pdf_annotations_protect_update
before update on public.pdf_annotations
for each row execute function private.protect_annotation_update();

create or replace function private.log_project_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'project.created';
  elsif new.status is distinct from old.status then
    v_action := 'project.status_changed';
  else
    v_action := 'project.updated';
  end if;

  insert into public.activity_log (
    household_id,
    actor_user_id,
    project_id,
    pattern_id,
    entity_type,
    entity_id,
    action,
    summary,
    details
  ) values (
    new.household_id,
    (select auth.uid()),
    new.id,
    new.pattern_id,
    'project',
    new.id,
    v_action,
    new.title,
    jsonb_build_object('status', new.status, 'progress_percent', new.progress_percent)
  );

  return new;
end;
$$;

revoke all on function private.log_project_change() from public;

create trigger projects_log_change
after insert or update of title, status, progress_percent, current_section, completed_on
on public.projects
for each row execute function private.log_project_change();

-- ---------------------------------------------------------------------------
-- Offline-safe, idempotent counter mutation
-- ---------------------------------------------------------------------------

create or replace function public.increment_project_counter(
  p_counter_id uuid,
  p_delta integer,
  p_client_mutation_id uuid
)
returns setof public.project_counters
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_household_id uuid := private.current_household_id();
  v_counter public.project_counters%rowtype;
  v_existing public.counter_mutations%rowtype;
  v_previous_counter_capability text;
begin
  if v_user_id is null or v_household_id is null then
    raise exception 'An active household member is required'
      using errcode = '42501';
  end if;

  if p_counter_id is null or p_client_mutation_id is null then
    raise exception 'counter_id and client_mutation_id are required'
      using errcode = '22004';
  end if;

  if p_delta is null or p_delta = 0 or abs(p_delta::bigint) > 1000000 then
    raise exception 'delta must be non-zero and between -1000000 and 1000000'
      using errcode = '22003';
  end if;

  -- One mutation ID can be retried from multiple tabs/devices. The advisory
  -- lock serializes those retries before checking the immutable ledger.
  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || p_client_mutation_id::text, 0)
  );

  select cm.*
    into v_existing
  from public.counter_mutations as cm
  where cm.user_id = v_user_id
    and cm.client_mutation_id = p_client_mutation_id;

  if found then
    if v_existing.counter_id <> p_counter_id
       or v_existing.delta <> p_delta then
      raise exception 'client_mutation_id was already used for a different operation'
        using errcode = '23505';
    end if;

    return query
      select pc.*
      from public.project_counters as pc
      where pc.id = p_counter_id
        and pc.household_id = v_household_id;
    return;
  end if;

  select pc.*
    into v_counter
  from public.project_counters as pc
  join public.projects as p
    on p.id = pc.project_id
   and p.household_id = pc.household_id
  where pc.id = p_counter_id
    and pc.household_id = v_household_id
    and p.deleted_at is null
    and (
      p.visibility = 'household'
      or p.owner_user_id = v_user_id
      or p.created_by = v_user_id
    )
  for update of pc;

  if not found then
    raise exception 'Counter not found or not accessible'
      using errcode = '42501';
  end if;

  v_previous_counter_capability :=
    current_setting('pattern_manager.counter_rpc', true);
  perform set_config('pattern_manager.counter_rpc', 'on', true);

  update public.project_counters as pc
  set current_value = greatest(0, pc.current_value + p_delta),
      revision = pc.revision + 1,
      updated_at = now()
  where pc.id = p_counter_id
  returning pc.* into v_counter;

  insert into public.counter_mutations (
    household_id,
    counter_id,
    user_id,
    client_mutation_id,
    delta,
    result_value,
    result_revision
  ) values (
    v_household_id,
    p_counter_id,
    v_user_id,
    p_client_mutation_id,
    p_delta,
    v_counter.current_value,
    v_counter.revision
  );

  insert into public.activity_log (
    household_id,
    actor_user_id,
    project_id,
    entity_type,
    entity_id,
    action,
    summary,
    details
  ) values (
    v_household_id,
    v_user_id,
    v_counter.project_id,
    'project_counter',
    v_counter.id,
    'counter.incremented',
    v_counter.name,
    jsonb_build_object(
      'delta', p_delta,
      'value', v_counter.current_value,
      'revision', v_counter.revision,
      'client_mutation_id', p_client_mutation_id
    )
  );

  perform set_config(
    'pattern_manager.counter_rpc',
    coalesce(v_previous_counter_capability, ''),
    true
  );

  return query
    select pc.*
    from public.project_counters as pc
    where pc.id = p_counter_id;
end;
$$;

comment on function public.increment_project_counter(uuid, integer, uuid) is
  'Atomically applies one bounded counter delta. A user mutation UUID is applied at most once.';
revoke all on function public.increment_project_counter(uuid, integer, uuid) from public;
revoke all on function public.increment_project_counter(uuid, integer, uuid) from anon;
grant execute on function public.increment_project_counter(uuid, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic catalog primary-file replacement
-- ---------------------------------------------------------------------------

create or replace function public.set_pattern_primary_asset(
  p_pattern_id uuid,
  p_asset_id uuid
)
returns setof public.patterns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_household_id uuid := private.current_household_id();
  v_pattern public.patterns%rowtype;
  v_previous_primary_capability text;
begin
  if v_user_id is null or v_household_id is null then
    raise exception 'An active household member is required'
      using errcode = '42501';
  end if;

  if p_pattern_id is null or p_asset_id is null then
    raise exception 'pattern_id and asset_id are required'
      using errcode = '22004';
  end if;

  -- Lock both household-owned records so a concurrent delete or replacement
  -- cannot interleave with the relation and denormalized pointer updates.
  select p.*
    into v_pattern
  from public.patterns as p
  where p.id = p_pattern_id
    and p.household_id = v_household_id
    and p.deleted_at is null
  for update;

  if not found then
    raise exception 'Pattern not found or not accessible'
      using errcode = '42501';
  end if;

  perform 1
  from public.assets as a
  where a.id = p_asset_id
    and a.household_id = v_household_id
    and a.storage_bucket = 'pattern-assets'
    and a.deleted_at is null
  for update;

  if not found then
    raise exception 'Asset not found or not accessible'
      using errcode = '42501';
  end if;

  v_previous_primary_capability :=
    current_setting('pattern_manager.primary_asset_rpc', true);
  perform set_config('pattern_manager.primary_asset_rpc', 'on', true);

  update public.pattern_assets as pa
  set is_primary = false
  where pa.household_id = v_household_id
    and pa.pattern_id = p_pattern_id
    and pa.is_primary;

  insert into public.pattern_assets (
    household_id,
    pattern_id,
    asset_id,
    role,
    is_primary,
    sort_order
  ) values (
    v_household_id,
    p_pattern_id,
    p_asset_id,
    'primary_instructions',
    true,
    0
  )
  on conflict (pattern_id, asset_id) do update
  set role = excluded.role,
      is_primary = true,
      sort_order = 0;

  update public.patterns as p
  set primary_asset_id = p_asset_id,
      updated_by = v_user_id
  where p.id = p_pattern_id
    and p.household_id = v_household_id;

  perform set_config(
    'pattern_manager.primary_asset_rpc',
    coalesce(v_previous_primary_capability, ''),
    true
  );

  return query
    select p.*
    from public.patterns as p
    where p.id = p_pattern_id
      and p.household_id = v_household_id;
end;
$$;

comment on function public.set_pattern_primary_asset(uuid, uuid) is
  'Atomically links a same-household asset as primary instructions and updates the pattern primary pointer.';
revoke all on function public.set_pattern_primary_asset(uuid, uuid) from public;
revoke all on function public.set_pattern_primary_asset(uuid, uuid) from anon;
grant execute on function public.set_pattern_primary_asset(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

create or replace function private.is_active_household_member(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members as hm
    where hm.household_id = private.current_household_id()
      and hm.user_id = p_user_id
      and hm.active
  )
$$;

revoke all on function private.is_active_household_member(uuid) from public;
grant execute on function private.is_active_household_member(uuid) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.import_batches enable row level security;
alter table public.assets enable row level security;
alter table public.patterns enable row level security;
alter table public.favorites enable row level security;
alter table public.pattern_assets enable row level security;
alter table public.projects enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_notes enable row level security;
alter table public.project_counters enable row level security;
alter table public.counter_mutations enable row level security;
alter table public.pdf_annotations enable row level security;
alter table public.pdf_sessions enable row level security;
alter table public.activity_log enable row level security;
alter table public.import_rows enable row level security;

create policy households_select_member
on public.households for select to authenticated
using (id = (select private.current_household_id()));

create policy household_members_select_self
on public.household_members for select to authenticated
using (
  user_id = (select auth.uid())
  and household_id = (select private.current_household_id())
  and active
);

create policy profiles_select_household
on public.profiles for select to authenticated
using (household_id = (select private.current_household_id()));

create policy profiles_insert_self
on public.profiles for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and user_id = (select auth.uid())
);

create policy profiles_update_self
on public.profiles for update to authenticated
using (user_id = (select auth.uid()))
with check (
  household_id = (select private.current_household_id())
  and user_id = (select auth.uid())
);

create policy user_settings_select_self
on public.user_settings for select to authenticated
using (user_id = (select auth.uid()));

create policy user_settings_insert_self
on public.user_settings for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and user_id = (select auth.uid())
);

create policy user_settings_update_self
on public.user_settings for update to authenticated
using (user_id = (select auth.uid()))
with check (
  household_id = (select private.current_household_id())
  and user_id = (select auth.uid())
);

create policy user_settings_delete_self
on public.user_settings for delete to authenticated
using (user_id = (select auth.uid()));

create policy assets_select_household
on public.assets for select to authenticated
using (
  household_id = (select private.current_household_id())
  and (
    storage_bucket = 'pattern-assets'
    or private.can_access_project(
      private.safe_uuid(split_part(storage_path, '/', 3))
    )
  )
);

create policy assets_insert_household
on public.assets for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and (created_by is null or created_by = (select auth.uid()))
  and (
    storage_bucket = 'pattern-assets'
    or private.can_access_project(
      private.safe_uuid(split_part(storage_path, '/', 3))
    )
  )
);

create policy assets_update_household
on public.assets for update to authenticated
using (
  household_id = (select private.current_household_id())
  and (
    storage_bucket = 'pattern-assets'
    or private.can_access_project(
      private.safe_uuid(split_part(storage_path, '/', 3))
    )
  )
)
with check (
  household_id = (select private.current_household_id())
  and (
    storage_bucket = 'pattern-assets'
    or private.can_access_project(
      private.safe_uuid(split_part(storage_path, '/', 3))
    )
  )
);

create policy patterns_select_household
on public.patterns for select to authenticated
using (household_id = (select private.current_household_id()));

create policy patterns_insert_household
on public.patterns for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and (created_by is null or created_by = (select auth.uid()))
);

create policy patterns_update_household
on public.patterns for update to authenticated
using (household_id = (select private.current_household_id()))
with check (household_id = (select private.current_household_id()));

create policy patterns_delete_household
on public.patterns for delete to authenticated
using (household_id = (select private.current_household_id()));

create policy favorites_select_self
on public.favorites for select to authenticated
using (
  household_id = (select private.current_household_id())
  and user_id = (select auth.uid())
);

create policy favorites_insert_self
on public.favorites for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and user_id = (select auth.uid())
);

create policy favorites_delete_self
on public.favorites for delete to authenticated
using (
  household_id = (select private.current_household_id())
  and user_id = (select auth.uid())
);

create policy pattern_assets_select_household
on public.pattern_assets for select to authenticated
using (household_id = (select private.current_household_id()));

create policy pattern_assets_insert_household
on public.pattern_assets for insert to authenticated
with check (household_id = (select private.current_household_id()));

create policy pattern_assets_update_household
on public.pattern_assets for update to authenticated
using (household_id = (select private.current_household_id()))
with check (household_id = (select private.current_household_id()));

create policy pattern_assets_delete_household
on public.pattern_assets for delete to authenticated
using (household_id = (select private.current_household_id()));

create policy projects_select_visible
on public.projects for select to authenticated
using ((select private.can_access_project(id)));

create policy projects_insert_visible
on public.projects for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and created_by = (select auth.uid())
  and (select private.is_active_household_member(owner_user_id))
);

create policy projects_update_visible
on public.projects for update to authenticated
using ((select private.can_access_project(id)))
with check (
  household_id = (select private.current_household_id())
  and (select private.is_active_household_member(owner_user_id))
  and (
    visibility = 'household'
    or owner_user_id = (select auth.uid())
    or created_by = (select auth.uid())
  )
);

create policy projects_delete_visible
on public.projects for delete to authenticated
using ((select private.can_access_project(id)));

create policy project_tasks_select_visible
on public.project_tasks for select to authenticated
using (
  household_id = (select private.current_household_id())
  and (select private.can_access_project(project_id))
);

create policy project_tasks_insert_visible
on public.project_tasks for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and created_by = (select auth.uid())
  and (select private.can_access_project(project_id))
);

create policy project_tasks_update_visible
on public.project_tasks for update to authenticated
using ((select private.can_access_project(project_id)))
with check (
  household_id = (select private.current_household_id())
  and (select private.can_access_project(project_id))
);

create policy project_tasks_delete_visible
on public.project_tasks for delete to authenticated
using ((select private.can_access_project(project_id)));

create policy project_notes_select_visible
on public.project_notes for select to authenticated
using (
  household_id = (select private.current_household_id())
  and (select private.can_access_project(project_id))
);

create policy project_notes_insert_self
on public.project_notes for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and author_id = (select auth.uid())
  and (select private.can_access_project(project_id))
);

create policy project_notes_update_self
on public.project_notes for update to authenticated
using (
  author_id = (select auth.uid())
  and (select private.can_access_project(project_id))
)
with check (
  household_id = (select private.current_household_id())
  and author_id = (select auth.uid())
  and (select private.can_access_project(project_id))
);

create policy project_notes_delete_self
on public.project_notes for delete to authenticated
using (
  author_id = (select auth.uid())
  and (select private.can_access_project(project_id))
);

create policy project_counters_select_visible
on public.project_counters for select to authenticated
using (
  household_id = (select private.current_household_id())
  and (select private.can_access_project(project_id))
);

create policy project_counters_insert_visible
on public.project_counters for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and user_id = (select auth.uid())
  and (select private.can_access_project(project_id))
);

create policy project_counters_update_visible
on public.project_counters for update to authenticated
using ((select private.can_access_project(project_id)))
with check (
  household_id = (select private.current_household_id())
  and (select private.can_access_project(project_id))
);

create policy project_counters_delete_visible
on public.project_counters for delete to authenticated
using ((select private.can_access_project(project_id)));

create policy counter_mutations_select_self
on public.counter_mutations for select to authenticated
using (
  household_id = (select private.current_household_id())
  and user_id = (select auth.uid())
);

create policy pdf_annotations_select_visible
on public.pdf_annotations for select to authenticated
using (
  household_id = (select private.current_household_id())
  and (select private.can_access_project(project_id))
);

create policy pdf_annotations_insert_self
on public.pdf_annotations for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and author_user_id = (select auth.uid())
  and (select private.can_access_project(project_id))
);

create policy pdf_annotations_update_self
on public.pdf_annotations for update to authenticated
using (
  author_user_id = (select auth.uid())
  and (select private.can_access_project(project_id))
)
with check (
  household_id = (select private.current_household_id())
  and author_user_id = (select auth.uid())
  and (select private.can_access_project(project_id))
);

create policy pdf_sessions_select_self
on public.pdf_sessions for select to authenticated
using (
  household_id = (select private.current_household_id())
  and user_id = (select auth.uid())
  and (select private.can_access_project(project_id))
);

create policy pdf_sessions_insert_self
on public.pdf_sessions for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and user_id = (select auth.uid())
  and (select private.can_access_project(project_id))
);

create policy pdf_sessions_update_self
on public.pdf_sessions for update to authenticated
using (
  user_id = (select auth.uid())
  and (select private.can_access_project(project_id))
)
with check (
  household_id = (select private.current_household_id())
  and user_id = (select auth.uid())
  and (select private.can_access_project(project_id))
);

create policy pdf_sessions_delete_self
on public.pdf_sessions for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select private.can_access_project(project_id))
);

create policy activity_log_select_visible
on public.activity_log for select to authenticated
using (
  household_id = (select private.current_household_id())
  and (project_id is null or (select private.can_access_project(project_id)))
);

create policy activity_log_insert_self
on public.activity_log for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and actor_user_id = (select auth.uid())
  and (project_id is null or (select private.can_access_project(project_id)))
);

create policy import_batches_select_household
on public.import_batches for select to authenticated
using (household_id = (select private.current_household_id()));

create policy import_batches_insert_owner
on public.import_batches for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and (select private.current_household_role()) = 'owner'
  and (created_by is null or created_by = (select auth.uid()))
);

create policy import_batches_update_owner
on public.import_batches for update to authenticated
using (
  household_id = (select private.current_household_id())
  and (select private.current_household_role()) = 'owner'
)
with check (
  household_id = (select private.current_household_id())
  and (select private.current_household_role()) = 'owner'
);

create policy import_batches_delete_owner
on public.import_batches for delete to authenticated
using (
  household_id = (select private.current_household_id())
  and (select private.current_household_role()) = 'owner'
);

create policy import_rows_select_household
on public.import_rows for select to authenticated
using (household_id = (select private.current_household_id()));

create policy import_rows_insert_owner
on public.import_rows for insert to authenticated
with check (
  household_id = (select private.current_household_id())
  and (select private.current_household_role()) = 'owner'
);

-- Table grants are deliberately explicit; RLS determines which rows survive.
revoke all on table
  public.households,
  public.household_members,
  public.profiles,
  public.user_settings,
  public.import_batches,
  public.assets,
  public.patterns,
  public.favorites,
  public.pattern_assets,
  public.projects,
  public.project_tasks,
  public.project_notes,
  public.project_counters,
  public.counter_mutations,
  public.pdf_annotations,
  public.pdf_sessions,
  public.activity_log,
  public.import_rows
from anon;

revoke all on table
  public.households,
  public.household_members,
  public.profiles,
  public.user_settings,
  public.import_batches,
  public.assets,
  public.patterns,
  public.favorites,
  public.pattern_assets,
  public.projects,
  public.project_tasks,
  public.project_notes,
  public.project_counters,
  public.counter_mutations,
  public.pdf_annotations,
  public.pdf_sessions,
  public.activity_log,
  public.import_rows
from authenticated;

grant select on public.households, public.household_members to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;
grant select, insert, update, delete on public.import_batches to authenticated;
grant select, insert, update on public.assets to authenticated;
grant select, insert, update, delete on public.patterns to authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant select, insert, update, delete on public.pattern_assets to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_tasks to authenticated;
grant select, insert, update, delete on public.project_notes to authenticated;
grant select, insert, update, delete on public.project_counters to authenticated;
grant select on public.counter_mutations to authenticated;
grant select, insert, update on public.pdf_annotations to authenticated;
grant select, insert, update, delete on public.pdf_sessions to authenticated;
grant select, insert on public.activity_log to authenticated;
grant select, insert on public.import_rows to authenticated;

grant all on table
  public.households,
  public.household_members,
  public.profiles,
  public.user_settings,
  public.import_batches,
  public.assets,
  public.patterns,
  public.favorites,
  public.pattern_assets,
  public.projects,
  public.project_tasks,
  public.project_notes,
  public.project_counters,
  public.counter_mutations,
  public.pdf_annotations,
  public.pdf_sessions,
  public.activity_log,
  public.import_rows
to service_role;

-- ---------------------------------------------------------------------------
-- Private Supabase Storage buckets
-- ---------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values
  (
    'pattern-assets',
    'pattern-assets',
    false,
    131072000,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]::text[]
  ),
  (
    'project-media',
    'project-media',
    false,
    131072000,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
  )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- pattern-assets path contract:
--   <household_uuid>/catalog/<prefix>/<sha256>.pdf
--   <household_uuid>/thumbnails/<pattern_uuid>.webp
create policy pattern_assets_objects_select
on storage.objects for select to authenticated
using (
  bucket_id = 'pattern-assets'
  and (storage.foldername(name))[1]
      = (select private.current_household_id())::text
);

create policy pattern_assets_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'pattern-assets'
  and (storage.foldername(name))[1]
      = (select private.current_household_id())::text
);

-- No authenticated UPDATE or DELETE policy is intentional: an original is
-- replaced by inserting a new immutable object and relinking through the RPC.

-- project-media path contract:
--   <household_uuid>/projects/<project_uuid>/<asset_filename>
-- A private project's files therefore remain private from the other member.
create policy project_media_objects_select
on storage.objects for select to authenticated
using (
  bucket_id = 'project-media'
  and (storage.foldername(name))[1]
      = (select private.current_household_id())::text
  and (storage.foldername(name))[2] = 'projects'
  and private.can_access_project(
    private.safe_uuid((storage.foldername(name))[3])
  )
);

create policy project_media_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-media'
  and (storage.foldername(name))[1]
      = (select private.current_household_id())::text
  and (storage.foldername(name))[2] = 'projects'
  and private.can_access_project(
    private.safe_uuid((storage.foldername(name))[3])
  )
);

-- Project-media objects are also append-only in v1. A future checked delete
-- RPC may remove the object and its database references in one transaction.

-- Make all future public-schema objects opt-in instead of automatically
-- reachable through the Data API. Existing Pattern Manager objects are
-- explicitly granted above.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

commit;
