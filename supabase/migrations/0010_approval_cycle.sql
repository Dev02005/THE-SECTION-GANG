-- Corridor - make the approval chain a cycle rather than a one-way street.
--
-- THE PROBLEM THIS FIXES
--
-- Every transition was one-way. A plan went draft -> submitted -> approved or
-- rejected, and nothing anywhere could move it back. So the first person to
-- press Approve left the demonstration plan approved permanently, and the only
-- way to a draft again was re-running a 174 KB seed file by hand. A workflow
-- that can be exercised exactly once is not a workflow anybody can be shown.
--
-- Two changes, and only one of them is a demonstration affordance.
--
-- 1. RESUBMISSION, which is real. A DRM who sends a plan back expects it
--    revised and brought again; a rejected plan that could never be resubmitted
--    would mean a single objection killed the week's programme. `submit_plan`
--    now accepts a plan that is draft OR rejected.
--
-- 2. `reset_plan`, which is NOT real, and is labelled as such wherever it
--    appears. No railway un-approves a programme - it supersedes it with a new
--    one. This exists because the instance is shared and has one plan in it, so
--    the alternative is a demonstration that works for the first visitor and
--    nobody after. Restricted to the DRM, and written to the audit log like
--    every other transition, so the reset is itself part of the record.

-- ---------------------------------------------------------------------------
-- 1. A rejected plan can be brought again
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
  --  Changed: a rejected plan is revised and brought again. Approved and
  --  submitted are still refused - the first is decided, the second is already
  --  with the DRM.
  if p.status not in ('draft', 'rejected') then
    raise exception 'plan is %, so it cannot be submitted', p.status;
  end if;

  update plans
     set status = 'submitted', submitted_by = o.id, submitted_at = now(),
         --  A resubmission is a fresh request: the previous decision must not
         --  sit on the row looking like the current one.
         decided_by = null, decided_at = null, decision_reason = null
   where id = p_plan_id returning * into p;
  insert into audit_log (actor, action, entity, entity_id)
       values (o.id, 'plan.submitted', 'plan', p_plan_id::text);
  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Back to draft. A demonstration affordance, and it says so.
-- ---------------------------------------------------------------------------

create or replace function reset_plan(
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
  --  The DRM owns the programme, so if anyone may put it back it is them.
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

  update plans
     set status = 'draft', submitted_by = null, submitted_at = null,
         decided_by = null, decided_at = null, decision_reason = null
   where id = p_plan_id returning * into p;
  --  Logged like everything else. A reset that left no trace would be the one
  --  transition the audit log could not account for.
  insert into audit_log (actor, action, entity, entity_id, detail)
       values (o.id, 'plan.reset', 'plan', p_plan_id::text,
               jsonb_build_object('note', 'demonstration reset to draft'));
  return p;
end;
$$;

comment on function reset_plan(text, text, uuid) is
  'Return a plan to draft. NOT a railway operation - a programme is superseded, '
  'never un-approved. It exists because this instance is shared and holds one '
  'plan, so without it the chain could be exercised exactly once.';

-- ---------------------------------------------------------------------------
-- Grants. The tables stay shut; the functions are the whole API.
-- ---------------------------------------------------------------------------

revoke all on function submit_plan(text, text, uuid) from public;
revoke all on function reset_plan(text, text, uuid) from public;
grant execute on function submit_plan(text, text, uuid) to anon, authenticated;
grant execute on function reset_plan(text, text, uuid) to anon, authenticated;
