-- Corridor - credentials and scoped access.
--
-- THE LOGINS LIVE HERE. There is no RailNet and no government directory to
-- authenticate against, so this table IS the identity provider: 425 posts, one
-- shared demonstration password, checked by Postgres.
--
-- TWO RULES, BOTH ENFORCED IN THE DATABASE
--
--   1. A credential is verified by a function. The password is a bcrypt hash
--      in a table no client can read, and the check runs here rather than in
--      JavaScript a user could edit.
--
--   2. AN OFFICER SEES THEIR OWN ZONE AND NOTHING ELSE. Sign in on Waltair and
--      you get East Coast Railway: its divisions, its stations, its plans. Not
--      Northern Railway's. A division post is narrowed further to its own
--      division's plan. This is scoping by authority, the way a real system
--      would do it, and it is applied inside the query rather than by asking
--      the client to filter honestly.
--
-- There are therefore NO blanket read policies. Every table stays closed to
-- the publishable key, and the only way in is a function that takes a
-- credential and returns what that post is entitled to. A caller who edits
-- their browser gets nothing extra, because the filter is not in the browser.
--
-- The password is the same for every post and printed on the sign-in page. It
-- is a demonstration credential, not a secret, and pretending otherwise would
-- be the theatre this project keeps refusing.

--  Supabase installs extensions into the `extensions` schema, not `public`.
--  Every function below therefore searches both: pinning `search_path = public`
--  alone hides crypt() from inside a SECURITY DEFINER function, even though it
--  resolves fine in a plain statement - which is exactly how this file failed
--  the first time it ran.
create extension if not exists pgcrypto with schema extensions;

alter table officers add column if not exists password_hash text;

--  Hashed rather than stored plain even though it is public knowledge: a
--  schema that keeps passwords in clear teaches the wrong thing to whoever
--  reads it next.
update officers set password_hash = crypt('block@2026', gen_salt('bf', 10))
 where password_hash is null;

alter table officers alter column password_hash set not null;

-- ---------------------------------------------------------------------------
-- The credential check. Everything below goes through it.
-- ---------------------------------------------------------------------------

create or replace function _officer(p_officer_id text, p_password text)
returns officers
language sql
stable
security definer
set search_path = public, extensions
as $$
  select * from officers
   where lower(id) = lower(trim(p_officer_id))
     and password_hash = crypt(p_password, password_hash)
   limit 1;
$$;

revoke all on function _officer(text, text) from public, anon, authenticated;

--  What the sign-in page calls. Returns an identity, never a credential:
--  password_hash is not in the column list.
create or replace function sign_in(p_officer_id text, p_password text)
returns table (
  id text, post text, designation text, full_name text,
  level post_level, zone_code text, division_code text,
  department department, remit text, zone_name text, division_name text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select o.id, o.post, o.designation, o.full_name, o.level,
         o.zone_code, o.division_code, o.department, o.remit,
         z.name, d.name
    from _officer(p_officer_id, p_password) o
    join zones z on z.code = o.zone_code
    left join divisions d
           on d.zone_code = o.zone_code and d.code = o.division_code;
$$;

-- ---------------------------------------------------------------------------
-- Scoped reads. Each one re-checks the credential and filters by the post's
-- own zone; a division post is narrowed again to its own division.
-- ---------------------------------------------------------------------------

--  The zone an officer may see, and the divisions inside it.
create or replace function my_zone(p_officer_id text, p_password text)
returns table (code text, name text, hq text, year int, divisions jsonb)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select z.code, z.name, z.hq, z.year,
         coalesce(
           (select jsonb_agg(jsonb_build_object('code', d.code, 'name', d.name)
                             order by d.name)
              from divisions d where d.zone_code = z.code),
           '[]'::jsonb)
    from _officer(p_officer_id, p_password) o
    join zones z on z.code = o.zone_code;
$$;

--  Officers in the caller's zone. A division post sees its own division's
--  five, plus the zone's own five above them - which is exactly the set of
--  people a block plan is argued between.
create or replace function my_officers(p_officer_id text, p_password text)
returns table (
  id text, post text, designation text, full_name text,
  level post_level, division_code text, department department, remit text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select t.id, t.post, t.designation, t.full_name,
         t.level, t.division_code, t.department, t.remit
    from _officer(p_officer_id, p_password) me
    join officers t on t.zone_code = me.zone_code
   where me.level = 'zone'
      or t.level = 'zone'
      or t.division_code = me.division_code;
$$;

--  Stations in the caller's zone.
create or replace function my_stations(p_officer_id text, p_password text)
returns table (code text, name text, state text, lat double precision, lon double precision)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select s.code, s.name, s.state, s.lat, s.lon
    from _officer(p_officer_id, p_password) o
    join stations s on s.zone_code = o.zone_code
   order by s.name;
$$;

--  The whole plan in one call: header, sections, both variants, shortfall and
--  protected paths. One round trip, and one place where the scope is applied.
--
--  A ZONE post sees every plan in its zone; a DIVISION post sees only its own.
--  Either way a caller from another zone gets nothing, because the join starts
--  from their own officer row.
create or replace function my_plan(p_officer_id text, p_password text)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  with me as (select * from _officer(p_officer_id, p_password)),
  p as (
    select pl.* from plans pl, me
     where pl.zone_code = me.zone_code
       and (me.level = 'zone' or pl.division_code = me.division_code)
     order by pl.generated_at desc
     limit 1
  )
  select case when (select count(*) from p) = 0 then null else
    jsonb_build_object(
      'plan', (select to_jsonb(p) from p),
      'sections', (select coalesce(jsonb_agg(to_jsonb(s) order by s.km_from), '[]'::jsonb)
                     from sections s, me where s.zone_code = me.zone_code),
      'kpis', (select coalesce(jsonb_object_agg(k.variant, to_jsonb(k)), '{}'::jsonb)
                 from kpis k, p where k.plan_id = p.id),
      'blocks', (select coalesce(jsonb_agg(to_jsonb(b) order by b.start_slot), '[]'::jsonb)
                   from blocks b, p where b.plan_id = p.id),
      'tasks', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
                  from tasks t, p where t.plan_id = p.id),
      'protectedPaths', (select coalesce(jsonb_agg(to_jsonb(pp) order by pp.entry_min), '[]'::jsonb)
                           from protected_paths pp, p where pp.plan_id = p.id)
    ) end;
$$;

--  The audit trail for the caller's zone.
--
--  Output columns are prefixed. In a SQL function the RETURNS TABLE names are
--  in scope, so a column called `actor` beside a table aliased `actor` makes
--  `actor.id` ambiguous and Postgres refuses the whole script - which is
--  exactly what happened the first time this file was run.
create or replace function my_audit(p_officer_id text, p_password text, p_limit int default 50)
returns table (
  log_at timestamptz, log_actor text, log_action text,
  log_entity text, log_entity_id text, log_detail jsonb
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select a.at, a.actor, a.action, a.entity, a.entity_id, a.detail
    from _officer(p_officer_id, p_password) me
    join audit_log a on true
    join officers who on who.id = a.actor
   where who.zone_code = me.zone_code
   order by a.at desc
   limit greatest(1, least(p_limit, 200));
$$;

-- ---------------------------------------------------------------------------
-- Writes. Credential and authority both re-checked before anything changes.
-- ---------------------------------------------------------------------------

create or replace function submit_plan(
  p_officer_id text, p_password text, p_plan_id uuid
)
returns plans
language plpgsql
security definer
set search_path = public, extensions
as $$
declare o officers%rowtype; p plans%rowtype;
begin
  o := _officer(p_officer_id, p_password);
  if o.id is null then raise exception 'invalid credentials'; end if;
  if o.post not in ('SrDEN', 'SrDSTE', 'SrDEE') then
    raise exception 'post % may not submit a plan', o.post;
  end if;

  select * into p from plans where id = p_plan_id;
  if not found then raise exception 'no such plan'; end if;
  if p.zone_code is distinct from o.zone_code
     or p.division_code is distinct from o.division_code then
    raise exception 'that plan belongs to another division';
  end if;
  if p.status <> 'draft' then raise exception 'plan is %, not draft', p.status; end if;

  update plans set status = 'submitted', submitted_by = o.id, submitted_at = now()
   where id = p_plan_id returning * into p;
  insert into audit_log (actor, action, entity, entity_id)
       values (o.id, 'plan.submitted', 'plan', p_plan_id::text);
  return p;
end;
$$;

create or replace function decide_plan(
  p_officer_id text, p_password text, p_plan_id uuid,
  p_approve boolean, p_reason text default null
)
returns plans
language plpgsql
security definer
set search_path = public, extensions
as $$
declare o officers%rowtype; p plans%rowtype;
begin
  o := _officer(p_officer_id, p_password);
  if o.id is null then raise exception 'invalid credentials'; end if;
  if o.post <> 'DRM' then raise exception 'post % may not decide a plan', o.post; end if;

  select * into p from plans where id = p_plan_id;
  if not found then raise exception 'no such plan'; end if;
  if p.zone_code is distinct from o.zone_code
     or p.division_code is distinct from o.division_code then
    raise exception 'that plan belongs to another division';
  end if;
  if p.status <> 'submitted' then raise exception 'plan is %, not submitted', p.status; end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'a rejection needs a reason';
  end if;

  update plans
     set status = case when p_approve then 'approved' else 'rejected' end::plan_status,
         decided_by = o.id, decided_at = now(), decision_reason = p_reason
   where id = p_plan_id returning * into p;
  insert into audit_log (actor, action, entity, entity_id, detail)
       values (o.id, case when p_approve then 'plan.approved' else 'plan.rejected' end,
               'plan', p_plan_id::text, jsonb_build_object('reason', p_reason));
  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. The functions are the whole API; the tables stay shut.
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'sign_in(text,text)', 'my_zone(text,text)', 'my_officers(text,text)',
    'my_stations(text,text)', 'my_plan(text,text)', 'my_audit(text,text,int)',
    'submit_plan(text,text,uuid)', 'decide_plan(text,text,uuid,boolean,text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

--  Deliberately absent: any select policy for anon or authenticated on any
--  table. Reading is only possible through the functions above, so scope is
--  not something the client can opt out of.
