-- Corridor - the database checks the plan before it will move it.
--
-- THE GAP THIS CLOSES
--
-- Twelve pre-approval checks run in the engine (engine/validate.py) and the
-- site holds Submit and Approve without a passing set. But the site is a
-- courtesy: `submit_plan` and `decide_plan` never looked, so a post calling the
-- database directly could approve a plan the site would hold. LIMITATIONS 6b
-- said so. This migration makes the database refuse instead.
--
-- TWO KINDS OF CHECK, AND THE DIFFERENCE IS STATED RATHER THAN BLURRED
--
--   1. RE-RUN HERE. Nine rules the database can answer from rows it holds -
--      blocks, tasks, protected trains, and the shortfall the plan declares -
--      are re-computed in SQL at the moment of submission and of approval.
--      Not copied from the engine's answer: computed again, by different code
--      in a different language, from the rows a signature would cover.
--
--   2. REQUIRED FROM THE ENGINE. What the database does not hold - machine and
--      gang counts, due dates, booked durations, blackout days - it cannot
--      check. For those it requires the engine's own record: all twelve passed,
--      AND the record belongs to this plan (the same objective, seed and build
--      time). A passing record of another build says nothing about this one.
--
-- Rejection and reset are never gated. A DRM must always be able to send back
-- a plan that fails; only moving it FORWARD needs the checks.
--
-- Run after 0011, then re-run 0004_seed_plan.sql: the seed writes the engine's
-- record and each job's end slot, which this migration adds columns for.

alter table plans add column if not exists checks jsonb;
alter table tasks add column if not exists end_slot int;

comment on column plans.checks is
  'The engine''s pre-approval checks (web/public/data/checks.json) as the seed '
  'wrote them. submit_plan and decide_plan require them to pass AND to belong '
  'to this plan; the rules the database can answer itself are re-run in SQL.';

-- ---------------------------------------------------------------------------
-- One check's result, in the shape engine/validate.py writes: the same keys,
-- so the site renders both with one component.
-- ---------------------------------------------------------------------------

create or replace function _rule(p_id text, p_name text, p_examined int, p_fails text[])
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_id,
    'name', p_name,
    'passed', coalesce(cardinality(p_fails), 0) = 0,
    'examined', coalesce(p_examined, 0),
    'failed', coalesce(cardinality(p_fails), 0),
    --  The first five by name; the count is always complete.
    'failures', to_jsonb(coalesce(p_fails[1:5], '{}'::text[])));
$$;

-- ---------------------------------------------------------------------------
-- The rules, over rows. PURE: it reads nothing but its arguments.
--
-- That is deliberate twice over. It is why the same function can be pointed at
-- the stored plan by submit/decide and at a deliberately broken copy by a test
-- - which is how each rule is shown to fail when its one condition is broken,
-- the standard every engine constraint is already held to. And it is why it
-- is safe to expose: it can compute over whatever it is handed, and there is
-- nothing else for it to read.
--
-- Arguments are the rows as `my_plan` returns them (to_jsonb of blocks, tasks
-- and protected_paths), plus the shortfall the plan declares.
-- ---------------------------------------------------------------------------

create or replace function plan_rule_checks(
  p_blocks jsonb, p_tasks jsonb, p_paths jsonb, p_shortfall jsonb, p_horizon_days int
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  with
  --  RULES: the engine's own constants, restated because SQL cannot import
  --  Python. tests/test_sql_rules.py reads this block and fails if any value
  --  stops matching engine/solver/config.py or engine/core/corridor.py - the
  --  write-it-twice bug this project has already met four times, guarded.
  --  RULES-BEGIN
  k as (
    select 96  as slots_day,       --  schema.SLOTS_DAY
           15  as slot_min,        --  15-minute slots
           1   as setup,           --  config.SETUP_SLOTS
           1   as clear,           --  config.CLEAR_SLOTS
           4   as min_slots,       --  Corridor.MIN_BLOCK_SLOTS
           16  as max_slots,       --  Corridor.MAX_BLOCK_SLOTS
           2   as per_day,         --  config.MAX_BLOCKS_PER_SECTION_DAY
           4   as nights,          --  config.MAX_NIGHT_BLOCKS_PER_SECTION_WEEK
           60  as night_from,      --  Corridor.WINDOWS night corridor, minutes
           300 as night_to,
           660 as day_from,        --  Corridor.WINDOWS mid-day corridor, minutes
           900 as day_to
  ),
  --  RULES-END
  b as (
    select x.id, x.section_id, x.scope, x.start_slot, x.dur_slots,
           x.start_slot + x.dur_slots as end_slot,
           x.start_slot / (select slots_day from k) as day,
           (x.start_slot % (select slots_day from k)) * (select slot_min from k) as m0,
           --  A SECTION block takes both roads; UP and DN take one each.
           array_remove(array[
             case when x.scope in ('UP', 'SECTION') then 'UP' end,
             case when x.scope in ('DN', 'SECTION') then 'DN' end], null) as roads
      from jsonb_to_recordset(coalesce(p_blocks, '[]'::jsonb)) as x(
             id text, variant text, section_id text, scope text,
             start_slot int, dur_slots int)
     where coalesce(x.variant, 'optimised') = 'optimised'
  ),
  t as (
    select x.*
      from jsonb_to_recordset(coalesce(p_tasks, '[]'::jsonb)) as x(
             id text, variant text, section_id text, criticality text,
             scheduled boolean, block_id text, start_slot int, end_slot int)
     where coalesce(x.variant, 'optimised') = 'optimised'
  ),
  placed as (select * from t where t.scheduled),
  paths as (
    select x.*
      from jsonb_to_recordset(coalesce(p_paths, '[]'::jsonb)) as x(
             train text, entry_min int, exit_min int, days_per_week int)
  ),
  night as (
    select b.* from b, k where b.m0 >= k.night_from and b.m0 < k.night_to
  )
  select jsonb_build_array(

    --  C1, the part the rows can answer: a permitted length, inside one of the
    --  two maintenance corridors. Blackout days are the engine's to confirm.
    _rule('C1', 'Every block inside a maintenance corridor, of a permitted length',
      (select count(*)::int from b),
      (select array_agg(b.id || case
                when b.dur_slots not between k.min_slots and k.max_slots
                  then ': ' || b.dur_slots || ' slots, outside ' || k.min_slots || '-' || k.max_slots
                else ': outside both maintenance corridors' end
              order by b.id)
         from b, k
        where b.dur_slots not between k.min_slots and k.max_slots
           or not (
                (b.m0 >= k.night_from and b.m0 + b.dur_slots * k.slot_min <= k.night_to)
             or (b.m0 >= k.day_from   and b.m0 + b.dur_slots * k.slot_min <= k.day_to)))),

    _rule('C7', 'One block per road at a time',
      (select count(*)::int from b),
      (select array_agg(x.id || ' and ' || y.id || ' hold the same road at once'
                        order by x.id, y.id)
         from b x join b y
           on x.id < y.id and x.section_id = y.section_id
          and x.roads && y.roads
          and x.start_slot < y.end_slot and y.start_slot < x.end_slot)),

    --  Every day of the horizon. The row says how many days a week a train
    --  runs, not which, so a train running fewer than seven is checked on all
    --  seven: stricter than the engine, never looser.
    _rule('PROT', 'No block across a protected train',
      (select count(*)::int from b),
      (select array_agg(distinct b.id || ': crosses ' || pth.train)
         from b, k, paths pth, generate_series(0, greatest(p_horizon_days, 1) - 1) as d
        where b.start_slot * k.slot_min < d * 1440 + pth.exit_min
                + case when pth.exit_min <= pth.entry_min then 1440 else 0 end
          and d * 1440 + pth.entry_min < b.end_slot * k.slot_min)),

    _rule('C2', 'No empty block, no job half-placed',
      (select count(*)::int from t),
      (select array_agg(m order by m) from (
         select b.id || ': granted with no work in it' as m
           from b where not exists (select 1 from placed where placed.block_id = b.id)
         union all
         select placed.id || ': placed in a block that is not in the plan'
           from placed where not exists (select 1 from b where b.id = placed.block_id)
         union all
         select placed.id || ': placed, with no start'
           from placed where placed.start_slot is null
         union all
         select t.id || ': deferred, but still in a block'
           from t where not t.scheduled and t.block_id is not null) f)),

    _rule('FIT', 'Each job on its own block''s section',
      (select count(*)::int from placed),
      (select array_agg(placed.id || ': on ' || placed.section_id || ', its block on ' || b.section_id
                        order by placed.id)
         from placed join b on b.id = placed.block_id
        where placed.section_id <> b.section_id)),

    --  Protection before the work, clearance after it. Whether the job is cut
    --  short needs its booked duration, which is the engine's to confirm.
    _rule('C6', 'Work inside protection and clearance',
      (select count(*)::int from placed),
      (select array_agg(placed.id || ': outside protection and clearance in ' || b.id
                        order by placed.id)
         from placed join b on b.id = placed.block_id, k
        where placed.end_slot is null
           or placed.start_slot < b.start_slot + k.setup
           or placed.end_slot > b.end_slot - k.clear
           or placed.end_slot <= placed.start_slot)),

    _rule('C9', 'At most ' || (select per_day from k) || ' blocks per section per day',
      (select count(*)::int from (select distinct section_id, day from b) g),
      (select array_agg(g.section_id || ' day ' || (g.day + 1) || ': ' || g.n || ' blocks'
                        order by g.section_id, g.day)
         from (select section_id, day, count(*) as n from b group by 1, 2) g, k
        where g.n > k.per_day)),

    _rule('C10', 'At most ' || (select nights from k) || ' night blocks per section per week',
      (select count(distinct section_id)::int from night),
      (select array_agg(g.section_id || ': ' || g.n || ' night blocks' order by g.section_id)
         from (select section_id, count(*) as n from night group by 1) g, k
        where g.n > k.nights)),

    _rule('STAT', 'Every statutory job left out is declared, with its reason',
      (select count(*)::int from t where t.criticality = 'A' and not t.scheduled),
      (select array_agg(t.id || ': statutory, not placed, and not declared' order by t.id)
         from t
        where t.criticality = 'A' and not t.scheduled
          and not exists (
            select 1 from jsonb_array_elements(coalesce(p_shortfall, '[]'::jsonb)) s
             where s->>'taskId' = t.id
               and coalesce(trim(s->>'bindingConstraint'), '') <> '')))
  );
$$;

comment on function plan_rule_checks(jsonb, jsonb, jsonb, jsonb, int) is
  'The pre-approval rules the database can answer from its own rows, re-run in '
  'SQL. Pure: reads only its arguments, so a test can hand it a broken copy.';

-- ---------------------------------------------------------------------------
-- A stored plan, checked: the rules above over its rows, and the engine's
-- record required to pass and to belong to it.
-- ---------------------------------------------------------------------------

create or replace function _plan_checks(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  p plans%rowtype;
  rules jsonb;
  c jsonb;
  present boolean;
  belongs boolean := false;
  engine_ok boolean := false;
  failing text[];
  n_engine int := 0;
begin
  select * into p from plans where id = p_plan_id;
  if not found then return null; end if;

  rules := plan_rule_checks(
    (select jsonb_agg(to_jsonb(b)) from blocks b
      where b.plan_id = p.id and b.variant = 'optimised'),
    (select jsonb_agg(to_jsonb(t)) from tasks t
      where t.plan_id = p.id and t.variant = 'optimised'),
    (select jsonb_agg(to_jsonb(pp)) from protected_paths pp where pp.plan_id = p.id),
    p.payload -> 'shortfall',
    p.horizon_days);

  c := p.checks;
  present := c is not null and jsonb_typeof(c -> 'checks') = 'array';
  if present then
    n_engine := jsonb_array_length(c -> 'checks');
    --  Of THIS plan: the same solve and the same build. The same test the site
    --  applies (web/lib/checks.ts checksMatch), applied where it cannot be
    --  edited out.
    --  coalesce: a missing key compares as NULL, and a NULL here would slide
    --  through `if not passed` as not-true-not-false - an absent field
    --  approving a plan. It must read as false.
    belongs := coalesce(
                 (c #>> '{plan,objective}') = p.objective::text
             and (c #>> '{plan,seed}') = p.seed::text
             and (c #>> '{plan,generatedAt}')::timestamptz = p.generated_at, false);
    select array_agg(e ->> 'id' order by e ->> 'id') into failing
      from jsonb_array_elements(c -> 'checks') e
     where coalesce((e ->> 'passed')::boolean, false) = false;
    engine_ok := n_engine > 0 and failing is null
             and coalesce((c ->> 'passed')::boolean, false);
  end if;

  return jsonb_build_object(
    'passed', coalesce(present and belongs and engine_ok
              and not exists (select 1 from jsonb_array_elements(rules) r
                               where not (r ->> 'passed')::boolean), false),
    'rules', rules,
    'engine', jsonb_build_object(
      'present', present,
      'belongs', belongs,
      'passed', engine_ok,
      'checks', n_engine,
      'failing', to_jsonb(coalesce(failing, '{}'::text[]))));
end;
$$;

--  The refusal's wording: which rules failed here, and what is wrong with the
--  engine's record. Named, because "checks failed" tells an officer nothing.
create or replace function _checks_refusal(v jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select concat_ws('; ',
    (select 'failed in the database: ' || string_agg(r ->> 'id', ', ')
       from jsonb_array_elements(v -> 'rules') r
      where not (r ->> 'passed')::boolean
     having count(*) > 0),
    case
      when not (v #>> '{engine,present}')::boolean then 'no engine check record for this plan'
      when not (v #>> '{engine,belongs}')::boolean then 'the engine''s checks are of a different build'
      when not (v #>> '{engine,passed}')::boolean then
        'failed in the engine: ' || (select string_agg(x, ', ')
                                       from jsonb_array_elements_text(v #> '{engine,failing}') x)
    end);
$$;

--  One line for the audit log: what was checked when the plan moved.
create or replace function _checks_summary(v jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'database', (select count(*) filter (where (r ->> 'passed')::boolean) || ' of ' || count(*)
                   from jsonb_array_elements(v -> 'rules') r),
    'engine', case when (v #>> '{engine,passed}')::boolean
                   then (v #>> '{engine,checks}') || ' of ' || (v #>> '{engine,checks}')
                   else 'not passing' end);
$$;

revoke all on function _plan_checks(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read the checks of a plan the caller may see. Scoped exactly like my_plan.
-- ---------------------------------------------------------------------------

create or replace function check_plan(p_officer_id text, p_password text, p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select _plan_checks(p.id)
    from _officer(p_officer_id, p_password) me
    join plans p on p.id = p_plan_id
                and p.zone_code = me.zone_code
                and (me.level = 'zone' or p.division_code = me.division_code);
$$;

-- ---------------------------------------------------------------------------
-- submit_plan - as 0011, and now refused unless the plan passes.
-- ---------------------------------------------------------------------------

create or replace function submit_plan(
  p_officer_id text, p_password text, p_plan_id uuid
)
returns plans
language plpgsql
security definer
set search_path = public, extensions
as $$
declare o officers%rowtype; p plans%rowtype; v jsonb;
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
  if p.status not in ('draft', 'rejected') then
    raise exception 'plan is %, so it cannot be submitted', p.status;
  end if;

  --  After authority, so a post with no business here learns nothing about
  --  the plan's checks from the refusal it gets.
  v := _plan_checks(p.id);
  if not coalesce((v ->> 'passed')::boolean, false) then
    raise exception 'plan fails its pre-approval checks, so it cannot be submitted (%)',
      _checks_refusal(v);
  end if;

  update plans
     set status = 'submitted', submitted_by = o.id, submitted_at = now(),
         decided_by = null, decided_at = null, decision_reason = null
   where id = p_plan_id returning * into p;
  insert into audit_log (actor, action, entity, entity_id, detail)
       values (o.id, 'plan.submitted', 'plan', p_plan_id::text,
               jsonb_build_object('plan_hash', p.plan_hash, 'checks', _checks_summary(v)));
  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- decide_plan - as 0011; an APPROVAL is refused unless the plan passes. A
-- rejection is never gated: sending back a failing plan is the point.
-- ---------------------------------------------------------------------------

create or replace function decide_plan(
  p_officer_id text, p_password text, p_plan_id uuid,
  p_approve boolean, p_reason text default null
)
returns plans
language plpgsql
security definer
set search_path = public, extensions
as $$
declare o officers%rowtype; p plans%rowtype; v jsonb;
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

  --  Re-run at the moment of approval, not trusted from submission: the rows
  --  could have changed in between, and this is the signature that counts.
  v := _plan_checks(p.id);
  if p_approve and not coalesce((v ->> 'passed')::boolean, false) then
    raise exception 'plan fails its pre-approval checks, so it cannot be approved - it can still be sent back (%)',
      _checks_refusal(v);
  end if;

  update plans
     set status = case when p_approve then 'approved' else 'rejected' end::plan_status,
         decided_by = o.id, decided_at = now(), decision_reason = p_reason
   where id = p_plan_id returning * into p;
  insert into audit_log (actor, action, entity, entity_id, detail)
       values (o.id, case when p_approve then 'plan.approved' else 'plan.rejected' end,
               'plan', p_plan_id::text,
               jsonb_build_object('reason', p_reason, 'plan_hash', p.plan_hash,
                                  'checks', _checks_summary(v)));
  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. submit_plan and decide_plan keep theirs (same signatures).
-- ---------------------------------------------------------------------------

revoke all on function check_plan(text, text, uuid) from public;
grant execute on function check_plan(text, text, uuid) to anon, authenticated;
--  Pure: computes over what it is handed and reads no table. Granted so the
--  live check suite can hand it a broken copy of the plan and watch it fail.
revoke all on function plan_rule_checks(jsonb, jsonb, jsonb, jsonb, int) from public;
grant execute on function plan_rule_checks(jsonb, jsonb, jsonb, jsonb, int) to anon, authenticated;
