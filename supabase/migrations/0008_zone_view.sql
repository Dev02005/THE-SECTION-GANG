-- Corridor - give the zonal posts the view their permission already implies.
--
-- THE BUG THIS FIXES
--
-- `my_plan` ends `order by generated_at desc limit 1`. For a divisional post
-- that is right: there is one division and one current plan. For a ZONAL post
-- it quietly throws away the question they actually have. A GM is entitled to
-- every plan in the zone and was handed exactly one of them, with nothing to
-- say the other divisions existed - so the permission was zone-wide and the
-- answer was a single division. The screen was not finished.
--
-- Two functions close it.
--
--   my_divisions   one row per division the caller may see, each carrying its
--                  current plan or nulls. A zonal post gets every division in
--                  the zone; a divisional post gets its own, so the same call
--                  serves both and the client needs no branch.
--
--   my_plan_for    the plan for a NAMED division, scoped exactly as before.
--
-- `my_plan` is redefined to call `my_plan_for(..., null)`, so the large jsonb
-- body exists once. Writing it twice and keeping the copies in step by hand is
-- the drift bug this project has already been bitten by four times.
--
-- Nothing here widens anyone's access. Every row still starts from the
-- caller's own officer row: another zone gets nothing, and a divisional post
-- naming a division that is not its own gets null rather than a plan.

-- ---------------------------------------------------------------------------
-- What is held, division by division
-- ---------------------------------------------------------------------------

create or replace function my_divisions(p_officer_id text, p_password text)
returns table (
  division_code   text,
  division_name   text,
  plan_id         uuid,
  reference       text,
  status          plan_status,
  generated_at    timestamptz,
  blocks          int,
  statutory_done  int,
  statutory_total int,
  detention_min   int
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with me as (select * from _officer(p_officer_id, p_password)),
  visible as (
    select d.code, d.name
      from divisions d, me
     where d.zone_code = me.zone_code
       --  A zonal post sees the whole zone; a divisional post sees its own.
       and (me.level = 'zone' or d.code = me.division_code)
  ),
  --  The current plan for each division: one row per division, newest first.
  --  `distinct on` needs the division to lead the ordering, which is why the
  --  sort is by division then date rather than date alone.
  current_plan as (
    select distinct on (pl.division_code) pl.*
      from plans pl, me
     where pl.zone_code = me.zone_code
     order by pl.division_code, pl.generated_at desc
  )
  select v.code, v.name,
         p.id, p.reference, p.status, p.generated_at,
         k.blocks, k.statutory_done, k.statutory_total, k.detention_minutes
    from visible v
    left join current_plan p on p.division_code = v.code
    left join kpis k on k.plan_id = p.id and k.variant = 'optimised'
   order by v.name;
$$;

comment on function my_divisions(text, text) is
  'One row per division the caller may see, each with its current plan or '
  'nulls. A division with no plan is a ROW WITH NULLS, never a missing row - '
  'the absence is the answer, and hiding it would be the same failure as '
  'showing another division''s numbers in its place.';

-- ---------------------------------------------------------------------------
-- The plan for a named division
-- ---------------------------------------------------------------------------

create or replace function my_plan_for(
  p_officer_id text, p_password text, p_division_code text default null
)
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
       --  Unchanged: a divisional post is pinned to its own division whatever
       --  it asks for. The new argument only narrows a zonal post's choice.
       and (me.level = 'zone' or pl.division_code = me.division_code)
       and (p_division_code is null or pl.division_code = p_division_code)
     order by pl.generated_at desc
     limit 1
  )
  select case when (select count(*) from p) = 0 then null else
    jsonb_build_object(
      'plan', (select to_jsonb(p) - 'payload' from p),
      'payload', (select p.payload from p),
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

--  One body, two entry points. The two-argument form is what every existing
--  caller uses and it keeps its old meaning exactly: the newest plan I may see.
create or replace function my_plan(p_officer_id text, p_password text)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select my_plan_for(p_officer_id, p_password, null);
$$;

-- ---------------------------------------------------------------------------
-- Grants. The tables stay shut; the functions are the whole API.
-- ---------------------------------------------------------------------------

revoke all on function my_divisions(text, text) from public;
revoke all on function my_plan_for(text, text, text) from public;
revoke all on function my_plan(text, text) from public;
grant execute on function my_divisions(text, text) to anon, authenticated;
grant execute on function my_plan_for(text, text, text) to anon, authenticated;
grant execute on function my_plan(text, text) to anon, authenticated;
