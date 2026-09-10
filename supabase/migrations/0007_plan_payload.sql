-- Corridor - carry the render payload on the plan row.
--
-- WHY A BLOB NEXT TO THE TABLES
--
-- The normalised tables hold what the DATABASE needs to reason about: which
-- division a plan belongs to, what state it is in, which blocks carry which
-- tasks, who submitted it. That is what scoping, the approval chain and the
-- audit trail are built on, and none of it could live in a blob.
--
-- What they do not hold is everything the SCREEN needs: the detention cost
-- surface behind the charts (4 sections x 2 roads x 672 slots), the per-block
-- explanations, the Pareto sweep, the model cards. Normalising those would be
-- six more tables serving one consumer that always wants all of it at once.
--
-- So the engine's artefact rides along as jsonb. This is a PROJECTION, not a
-- second source of truth, and one condition keeps it honest: both are written
-- by the same seed file in the same transaction, from the same plan.json. They
-- cannot drift, because nothing can write one without the other.
--
-- The blob is returned only through `my_plan`, so it inherits the same zone
-- and division scoping as everything else. A Northern Railway officer gets
-- null, exactly as before - the payload does not open a side door.

alter table plans add column if not exists payload jsonb;

comment on column plans.payload is
  'The engine artefact as rendered. A projection of the normalised rows plus '
  'the detention surface, explanations and Pareto sweep the UI needs; written '
  'by the same seed, in the same transaction, so the two cannot disagree.';

--  Same scoping as before; the payload simply travels with it.
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

revoke all on function my_plan(text, text) from public;
grant execute on function my_plan(text, text) to anon, authenticated;
