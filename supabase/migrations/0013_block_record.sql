-- Corridor - the plan as worked: each block granted, returned, or not availed.
--
-- WHY
--
-- Until now the system stopped at approval. A programme is approved on Friday
-- and worked through the week, and what happens on the ground - a block given
-- forty minutes late, returned late, not availed at all because a train ran
-- late - never came back to the plan. Without that record there is no way to
-- say whether the plan was workable, only whether it was approved.
--
-- WHO RECORDS
--
-- The operating branch. On the ground the Station Masters at each end of the
-- section record block taken and block returned in the Train Signal Register,
-- and the section controller keeps the control chart - all under the Sr.DOM;
-- the three departments that asked for the block do not certify their own use
-- of it. The 425 posts here stop at the Sr.DOM - there is no station or
-- controller post, because the controller view was cut - so the Sr.DOM's
-- credential stands in for them. Said, rather than implied.
--
-- WHAT IS RECORDED, per block of an APPROVED plan (a draft is not worked):
--
--   granted       the block is on; the time it was given
--   completed     given and returned, the work done
--   partial       given and returned, work left - and what, in the note
--   not_availed   never given - and why, in the note
--
-- Times are minutes from 00:00 on the Monday that begins the plan week, the
-- same origin the plan's own slots use (slot x 15), so planned and actual are
-- compared without a calendar convention that nothing else in the system has.
--
-- One row per block, so the screen reads the block's current state. Every
-- recording - the first and each correction - is ALSO written to the audit
-- log with the value it replaced, and the audit log cannot be revised. A
-- correction therefore never erases what it corrected.
--
-- Run after 0012.

create table if not exists block_actuals (
  plan_id      uuid not null references plans(id) on delete cascade,
  block_id     text not null,
  state        text not null
               check (state in ('granted', 'completed', 'partial', 'not_availed')),
  granted_min  int,
  returned_min int,
  note         text,
  recorded_by  text not null references officers(id),
  recorded_at  timestamptz not null default now(),
  primary key (plan_id, block_id),
  --  The function below gives each of these a sentence an officer can act on.
  --  These are the backstop, so a write that bypassed it still cannot store a
  --  state that contradicts its own times.
  constraint block_actual_times_fit_state check (
    case state
      when 'not_availed' then granted_min is null and returned_min is null
      when 'granted'     then granted_min is not null and returned_min is null
      else granted_min is not null and returned_min is not null
    end),
  constraint block_actual_returned_after_granted
    check (returned_min is null or returned_min > granted_min),
  constraint block_actual_within_a_day
    check (returned_min is null or returned_min - granted_min <= 1440),
  constraint block_actual_reason_given
    check (state not in ('partial', 'not_availed') or coalesce(trim(note), '') <> '')
);

--  Closed like every other table: no policy, so the only way in or out is a
--  function that checks the credential first.
alter table block_actuals enable row level security;

-- ---------------------------------------------------------------------------
-- Record a block
-- ---------------------------------------------------------------------------

create or replace function record_block(
  p_officer_id text, p_password text, p_plan_id uuid, p_block_id text,
  p_state text, p_granted_min int default null, p_returned_min int default null,
  p_note text default null
)
returns block_actuals
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  o officers%rowtype; p plans%rowtype; b blocks%rowtype;
  prev block_actuals%rowtype; a block_actuals%rowtype;
  note text := nullif(trim(coalesce(p_note, '')), '');
begin
  o := _officer(p_officer_id, p_password);
  if o.id is null then raise exception 'invalid credentials'; end if;
  if o.post <> 'SrDOM' then
    raise exception 'post % may not record a block - the operating branch (Sr.DOM) does', o.post;
  end if;

  select * into p from plans where id = p_plan_id;
  if not found then raise exception 'no such plan'; end if;
  if p.zone_code is distinct from o.zone_code
     or p.division_code is distinct from o.division_code then
    raise exception 'that plan belongs to another division';
  end if;
  if p.status <> 'approved' then
    raise exception 'plan is %: only an approved plan is worked', p.status;
  end if;

  select * into b from blocks
   where plan_id = p.id and variant = 'optimised' and id = p_block_id;
  if not found then raise exception 'block % is not in this plan', p_block_id; end if;

  --  Each rule in words, before the table's constraints would refuse it in
  --  theirs.
  if p_state is null or p_state not in ('granted', 'completed', 'partial', 'not_availed') then
    raise exception 'unknown state %', p_state;
  end if;
  if p_state = 'not_availed' then
    if p_granted_min is not null or p_returned_min is not null then
      raise exception 'a block not availed has no times';
    end if;
    if note is null then raise exception 'say why the block was not availed'; end if;
  else
    if p_granted_min is null then raise exception 'record when the block was granted'; end if;
    if p_granted_min < 0 or p_granted_min >= p.horizon_days * 1440 then
      raise exception 'the block must be granted within the plan week';
    end if;
    if p_state = 'granted' and p_returned_min is not null then
      raise exception 'a block still on has no return time - record it as completed or partial';
    end if;
    if p_state in ('completed', 'partial') and p_returned_min is null then
      raise exception 'record when the line was returned to traffic';
    end if;
    if p_returned_min is not null and p_returned_min <= p_granted_min then
      raise exception 'the line cannot be returned before the block was granted';
    end if;
    if p_returned_min is not null and p_returned_min - p_granted_min > 1440 then
      raise exception 'a block longer than a day is not one block';
    end if;
    if p_state = 'partial' and note is null then
      raise exception 'say what work was left undone';
    end if;
  end if;

  select * into prev from block_actuals where plan_id = p.id and block_id = b.id;

  insert into block_actuals as x
         (plan_id, block_id, state, granted_min, returned_min, note, recorded_by, recorded_at)
  values (p.id, b.id, p_state, p_granted_min, p_returned_min, note, o.id, now())
  on conflict (plan_id, block_id) do update
     set state = excluded.state, granted_min = excluded.granted_min,
         returned_min = excluded.returned_min, note = excluded.note,
         recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at
  returning * into a;

  --  What it replaced goes in the log with it. The row keeps only the latest;
  --  the log keeps every version, and nothing can edit the log.
  insert into audit_log (actor, action, entity, entity_id, detail)
       values (o.id, 'block.recorded', 'block', b.id,
               jsonb_build_object(
                 'plan_id', p.id, 'state', a.state,
                 'granted_min', a.granted_min, 'returned_min', a.returned_min,
                 'note', a.note,
                 'replaced', case when prev.plan_id is null then null else
                   jsonb_build_object('state', prev.state, 'granted_min', prev.granted_min,
                                      'returned_min', prev.returned_min, 'note', prev.note) end));
  return a;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read the record of a plan the caller may see. Scoped exactly like my_plan:
-- a zonal post sees its zone's plans, a divisional post its own division's.
-- ---------------------------------------------------------------------------

create or replace function my_actuals(p_officer_id text, p_password text, p_plan_id uuid)
returns setof block_actuals
language sql
stable
security definer
set search_path = public, extensions
as $$
  select a.*
    from _officer(p_officer_id, p_password) me
    join plans p on p.id = p_plan_id
                and p.zone_code = me.zone_code
                and (me.level = 'zone' or p.division_code = me.division_code)
    join block_actuals a on a.plan_id = p.id
   order by a.block_id;
$$;

-- ---------------------------------------------------------------------------
-- reset_plan - as 0010, and it now clears the record of the plan it resets.
--
-- A record of blocks worked against a plan that is a draft again describes a
-- programme that no longer exists. The reset is a demonstration affordance
-- (see 0010) and so is this: the count cleared goes in the log, and every
-- recording it clears is already in the log in full.
-- ---------------------------------------------------------------------------

create or replace function reset_plan(
  p_officer_id text, p_password text, p_plan_id uuid
)
returns plans
language plpgsql
security definer
set search_path = public, extensions
as $$
declare o officers%rowtype; p plans%rowtype; cleared int;
begin
  o := _officer(p_officer_id, p_password);
  if o.id is null then raise exception 'invalid credentials'; end if;
  if o.post <> 'DRM' then
    raise exception 'post % may not reset a plan', o.post;
  end if;

  select * into p from plans where id = p_plan_id;
  if not found then raise exception 'no such plan'; end if;
  if p.zone_code is distinct from o.zone_code
     or p.division_code is distinct from o.division_code then
    raise exception 'that plan belongs to another division';
  end if;
  if p.status = 'draft' then raise exception 'plan is already a draft'; end if;

  delete from block_actuals where plan_id = p_plan_id;
  get diagnostics cleared = row_count;

  update plans
     set status = 'draft', submitted_by = null, submitted_at = null,
         decided_by = null, decided_at = null, decision_reason = null
   where id = p_plan_id returning * into p;
  insert into audit_log (actor, action, entity, entity_id, detail)
       values (o.id, 'plan.reset', 'plan', p_plan_id::text,
               jsonb_build_object('note', 'demonstration reset to draft',
                                  'blocks_record_cleared', cleared));
  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. The table stays shut; the functions are the whole API.
-- ---------------------------------------------------------------------------

revoke all on function record_block(text, text, uuid, text, text, int, int, text) from public;
revoke all on function my_actuals(text, text, uuid) from public;
grant execute on function record_block(text, text, uuid, text, text, int, int, text) to anon, authenticated;
grant execute on function my_actuals(text, text, uuid) to anon, authenticated;
