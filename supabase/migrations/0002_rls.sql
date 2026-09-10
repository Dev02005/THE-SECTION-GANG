-- Corridor - row level security.
--
-- This is the file that makes the sign-in real. Until now the gate lived in
-- the browser and controlled the interface rather than the data; these
-- policies are enforced by Postgres, so a request without a valid session gets
-- nothing back no matter what the client does with it.
--
-- The rule mirrors the division. Any signed-in officer may READ the plan -
-- there is no number in it one post should see and another should not, and
-- pretending otherwise would be theatre. What differs is who may CHANGE its
-- state: the three department heads submit, and only the DRM decides. That is
-- how a block programme actually moves, and it is expressed here rather than
-- in a component that a determined user could route around.

alter table zones            enable row level security;
alter table divisions        enable row level security;
alter table officers         enable row level security;
alter table profiles         enable row level security;
alter table stations         enable row level security;
alter table sections         enable row level security;
alter table plans            enable row level security;
alter table tasks            enable row level security;
alter table blocks           enable row level security;
alter table kpis             enable row level security;
alter table protected_paths  enable row level security;
alter table audit_log        enable row level security;

-- ---------------------------------------------------------------------------
-- Who am I? Helpers used by the policies below.
-- ---------------------------------------------------------------------------

create or replace function current_officer()
returns officers
language sql
stable
security definer
set search_path = public
as $$
  select o.* from officers o
  join profiles p on p.officer_id = o.id
  where p.user_id = auth.uid()
  limit 1;
$$;

create or replace function current_post()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select o.post from officers o
  join profiles p on p.officer_id = o.id
  where p.user_id = auth.uid()
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Reference data: readable by any signed-in officer, writable by nobody.
--
-- The Ministry list and the station master are published facts. They are
-- seeded by a migration, not by the application, so there is no insert policy
-- at all - the absence is the point.
-- ---------------------------------------------------------------------------

create policy "signed-in officers read zones"
  on zones for select to authenticated using (true);

create policy "signed-in officers read divisions"
  on divisions for select to authenticated using (true);

create policy "signed-in officers read officers"
  on officers for select to authenticated using (true);

create policy "signed-in officers read stations"
  on stations for select to authenticated using (true);

create policy "signed-in officers read sections"
  on sections for select to authenticated using (true);

-- A person sees their own profile and no one else's.
create policy "read own profile"
  on profiles for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The plan: read by all, moved by few.
-- ---------------------------------------------------------------------------

create policy "signed-in officers read plans"
  on plans for select to authenticated using (true);

create policy "signed-in officers read tasks"
  on tasks for select to authenticated using (true);

create policy "signed-in officers read blocks"
  on blocks for select to authenticated using (true);

create policy "signed-in officers read kpis"
  on kpis for select to authenticated using (true);

create policy "signed-in officers read protected paths"
  on protected_paths for select to authenticated using (true);

-- Submit: the three department heads, and only on their own division's draft.
create policy "department heads submit a draft"
  on plans for update to authenticated
  using (
    status = 'draft'
    and current_post() in ('SrDEN', 'SrDSTE', 'SrDEE')
    and division_code = (current_officer()).division_code
    and zone_code = (current_officer()).zone_code
  )
  with check (status in ('draft', 'submitted'));

-- Decide: the DRM of that division, and only on something submitted.
create policy "the DRM decides a submitted plan"
  on plans for update to authenticated
  using (
    status = 'submitted'
    and current_post() = 'DRM'
    and division_code = (current_officer()).division_code
    and zone_code = (current_officer()).zone_code
  )
  with check (status in ('submitted', 'approved', 'rejected'));

-- ---------------------------------------------------------------------------
-- Audit: append-only, and attributed.
--
-- No update policy and no delete policy anywhere. A log that can be edited is
-- not a log, and a block plan is an auditable document.
-- ---------------------------------------------------------------------------

create policy "signed-in officers read the audit log"
  on audit_log for select to authenticated using (true);

create policy "officers append to the audit log as themselves"
  on audit_log for insert to authenticated
  with check (actor = (current_officer()).id);
