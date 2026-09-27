-- Corridor - the plan's fingerprint, recorded where it cannot be revised.
--
-- A SHA-256 of what the plan grants (web/lib/fingerprint.ts) is written onto
-- the plan row by the seed. On its own that proves nothing: whoever can edit a
-- plan can edit the hash sitting beside it.
--
-- What makes it evidence is the audit log. `audit_log` has a select policy and
-- an insert policy and NO update or delete policy, and no routine in this
-- schema edits a row. So this migration makes submission and decision each
-- write the plan's fingerprint into the log, at the moment they happen. The
-- fingerprint of the plan that was approved is then fixed in a table nothing
-- can revise - and a plan altered afterwards no longer matches it.
--
-- Run after 0010. Idempotent: `add column if not exists`, and both functions
-- are `create or replace` with unchanged signatures, which keeps their grants.

alter table plans add column if not exists plan_hash text;

comment on column plans.plan_hash is
  'SHA-256 (lower-case hex) of the plan''s blocks and tasks, canonicalised by '
  'web/lib/fingerprint.ts. Written by the seed; copied into audit_log.detail '
  'on submission and decision. Excludes status and approver fields, so moving '
  'through the approval chain does not change it.';

-- ---------------------------------------------------------------------------
-- submit_plan - unchanged from 0010 except that the log entry now carries the
-- fingerprint of the plan being submitted.
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
  if p.status not in ('draft', 'rejected') then
    raise exception 'plan is %, so it cannot be submitted', p.status;
  end if;

  update plans
     set status = 'submitted', submitted_by = o.id, submitted_at = now(),
         decided_by = null, decided_at = null, decision_reason = null
   where id = p_plan_id returning * into p;
  insert into audit_log (actor, action, entity, entity_id, detail)
       values (o.id, 'plan.submitted', 'plan', p_plan_id::text,
               jsonb_build_object('plan_hash', p.plan_hash));
  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- decide_plan - unchanged from 0005 except that the log entry now carries the
-- fingerprint beside the reason. This is the entry that matters: the
-- fingerprint of the plan as it was APPROVED.
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
               'plan', p_plan_id::text,
               jsonb_build_object('reason', p_reason, 'plan_hash', p.plan_hash));
  return p;
end;
$$;
