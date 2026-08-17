-- Allow INSERT/UPDATE ... RETURNING to evaluate project visibility against the
-- new row itself. The original policy called a STABLE helper that re-queried
-- public.projects; PostgreSQL's statement snapshot cannot see a row inserted by
-- the same statement, so PostgREST inserts with .select() were rejected by RLS.

begin;

drop policy if exists projects_select_visible on public.projects;

create policy projects_select_visible
on public.projects for select to authenticated
using (
  household_id = (select private.current_household_id())
  and deleted_at is null
  and (
    visibility = 'household'
    or owner_user_id = (select auth.uid())
    or created_by = (select auth.uid())
  )
);

comment on policy projects_select_visible on public.projects is
  'Row-local project visibility; safe for PostgREST INSERT/UPDATE RETURNING.';

commit;
