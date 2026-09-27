-- Corridor - schema.
--
-- Supabase is the system of record. The engine still computes the plan (that
-- is CP-SAT's job, not Postgres's), but what it computes is written here, and
-- the site reads here rather than from a file.
--
-- Two access patterns, deliberately different:
--
--   * The PLAN is read at build time and prerendered. It changes when a
--     planner re-solves, not when a page is requested, so serving it from a
--     static render costs nothing in freshness and means a cold database
--     cannot take the planner down.
--   * IDENTITY, WORKFLOW and AUDIT are read live. An approval that showed a
--     stale status would be worse than useless, and these are the rows that
--     actually change while someone is looking at them.
--
-- Every table is RLS-enabled. The rule throughout is that a signed-in officer
-- may READ the division's plan, and only specific posts may change its state -
-- which mirrors the real thing, where three officers submit and the DRM grants.

-- ---------------------------------------------------------------------------
-- Organisation: the Ministry list, and the posts that sit on it
-- ---------------------------------------------------------------------------

create table if not exists zones (
  code        text primary key,
  name        text not null,
  hq          text not null,
  year        int  not null
);

create table if not exists divisions (
  code        text not null,
  zone_code   text not null references zones(code) on delete cascade,
  name        text not null,
  -- Nagpur exists in CR and SECR; Lucknow in NR and NER. The railway has to
  -- qualify them by zone and so must the key.
  primary key (zone_code, code)
);

create type post_level as enum ('zone', 'division');
create type department as enum ('ENGG', 'SNT', 'TRD');

create table if not exists officers (
  id           text primary key,               -- SrDEN/ECoR/WAT
  post         text not null,                  -- SrDEN
  designation  text not null,                  -- Sr.DEN
  full_name    text not null,
  level        post_level not null,
  zone_code    text not null references zones(code) on delete cascade,
  division_code text,
  department   department,                     -- null for DRM, Sr.DOM, GM, PCOM
  remit        text not null
);

create index if not exists officers_zone_idx on officers (zone_code, division_code);

-- A Supabase auth user is a person; an officer is a post. One person holds one
-- post at a time, and the post is what a plan is approved by.
create table if not exists profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  officer_id  text not null references officers(id),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Corridor: real geometry, derived from published coordinates
-- ---------------------------------------------------------------------------

create table if not exists stations (
  code       text primary key,
  name       text not null,
  zone_code  text references zones(code),
  state      text,
  lat        double precision,
  lon        double precision
);

create table if not exists sections (
  id            text primary key,              -- SEC-01
  division_code text not null,
  zone_code     text not null,
  name          text not null,
  km_from       numeric(6,1) not null,
  km_to         numeric(6,1) not null
);

-- ---------------------------------------------------------------------------
-- Plans: what the solver produced, and where it is in the approval chain
-- ---------------------------------------------------------------------------

create type plan_status as enum ('draft', 'submitted', 'approved', 'rejected', 'superseded');

create table if not exists plans (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique,        -- SIH26027/7/2026-09-06
  zone_code       text not null references zones(code),
  division_code   text not null,
  horizon_days    int  not null,
  seed            int,
  status          plan_status not null default 'draft',
  -- Provenance travels with the plan, so a row can always answer "which
  -- models, which solver run, which corridor" without joining to anything.
  solver_status   text,
  objective       bigint,
  bound           bigint,
  placement_objective bigint,
  placement_bound bigint,
  generated_at    timestamptz not null,
  submitted_by    text references officers(id),
  submitted_at    timestamptz,
  decided_by      text references officers(id),
  decided_at      timestamptz,
  decision_reason text,
  --  The engine artefact as the screen renders it. Declared here rather than
  --  only in 0007 because 0004 WRITES it: run in numeric order on a fresh
  --  database, 0004 used to fail on a column that did not exist yet. 0007's
  --  `add column if not exists` is a no-op now, and still correct on any
  --  database that was built before this line.
  payload         jsonb,
  --  SHA-256 of what the plan grants - see web/lib/fingerprint.ts. Declared
  --  here for the same reason as payload: 0004 writes it, and 0004 runs before
  --  0011 on a fresh database.
  plan_hash       text,
  created_at      timestamptz not null default now()
);

create index if not exists plans_division_idx on plans (zone_code, division_code, status);

create type criticality as enum ('A', 'B', 'C');
create type block_scope as enum ('UP', 'DN', 'SECTION');

create table if not exists tasks (
  id           text not null,
  plan_id      uuid not null references plans(id) on delete cascade,
  -- Which side of the comparison this row belongs to. Both plans are scored by
  -- one function on one instance, so both live here and are told apart by this
  -- column rather than by living in different tables.
  variant      text not null check (variant in ('optimised', 'baseline')),
  department   department not null,
  section_id   text not null,
  activity     text not null,
  criticality  criticality not null,
  km           numeric(6,1),
  scheduled    boolean not null,
  block_id     text,
  start_slot   int,
  risk_rate    int,
  primary key (plan_id, variant, id)
);

create table if not exists blocks (
  id             text not null,
  plan_id        uuid not null references plans(id) on delete cascade,
  variant        text not null check (variant in ('optimised', 'baseline')),
  section_id     text not null,
  scope          block_scope not null,
  day            int not null,
  start_slot     int not null,
  dur_slots      int not null,
  start_hhmm     text not null,
  end_hhmm       text not null,
  detention_min  int not null,
  clubbed        boolean not null,
  departments    department[] not null,
  primary key (plan_id, variant, id)
);

create index if not exists blocks_plan_idx on blocks (plan_id, variant);

create table if not exists kpis (
  plan_id            uuid not null references plans(id) on delete cascade,
  variant            text not null check (variant in ('optimised', 'baseline')),
  blocks             int not null,
  block_hours        numeric(8,1) not null,
  detention_minutes  int not null,
  detention_per_task numeric(8,1) not null,
  risk_carried       int not null,
  scheduled          int not null,
  statutory_done     int not null,
  statutory_total    int not null,
  multidept_pct      numeric(5,1) not null,
  packing            numeric(6,2) not null,
  primary key (plan_id, variant)
);

-- Premium paths a block is never drawn across, measured from the timetable.
create table if not exists protected_paths (
  plan_id     uuid not null references plans(id) on delete cascade,
  train       text not null,
  name        text not null,
  entry_min   int not null,
  exit_min    int not null,
  days_per_week int not null,
  primary key (plan_id, train)
);

-- ---------------------------------------------------------------------------
-- Audit: every state change, attributed to a post
-- ---------------------------------------------------------------------------

create table if not exists audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       text references officers(id),
  action      text not null,
  entity      text not null,
  entity_id   text,
  detail      jsonb
);

create index if not exists audit_log_at_idx on audit_log (at desc);
