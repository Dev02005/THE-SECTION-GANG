# Corridor — Automatic Block Planning

**Three registers. One corridor. One plan.**

Joint maintenance block planning for Indian Railways. Engineering, S&T and
Traction each keep their own register and each ask the corridor for time
separately; Corridor plans all three together, pricing asset risk and train
detention in one unit and buying the most risk reduction per minute of line
occupation.

**Smart India Hackathon 2026 · Problem statement SIH26027 · Ministry of Railways**

**Live:** [the-section-gang.vercel.app](https://the-section-gang.vercel.app) · **Code:** [github.com/Dev02005/THE-SECTION-GANG](https://github.com/Dev02005/THE-SECTION-GANG)

`Python 3.14` · `OR-Tools CP-SAT` · `scikit-learn` · `Next.js 16` · `PostgreSQL / Supabase` · `MIT`

---

## The idea

Nothing in the present process puts the three departments' registers in front
of a division together, so work that could travel in one block is granted as
three — and a block at 02:30 looks as free as one at 07:30, though they are
nothing alike in the traffic they hold up.

Corridor prices both sides in the same unit, **detention-minute equivalents**:
what a defect will eventually cost in train delay if left alone, and what a
block costs in train delay at that hour on that section. With both in one
currency, a constraint-programming model can trade them against each other
across all three departments at once.

We do not *rank* maintenance tasks. We *price* them.

---

## Measured result

90 tasks, model-priced, deterministic, 90-second solve. Both plans are scored
by one function on one instance, so the comparison cannot be tilted.

| Metric | Current practice | Optimised | Change |
|---|---|---|---|
| Blocks granted | 43 | 18 | **−58.1%** |
| Block-hours on line | 116.8 | 53.8 | −53.9% |
| Train detention (min) | 14,165 | 6,875 | **−51.5%** |
| Detention per task done | 329.4 | 143.2 | **−56.5%** |
| Residual risk carried | 8,549 | 4,919 | −42.5% |
| Tasks completed | 43 | 48 | +11.6% |
| Statutory closed | 21/35 | 30/35 | |
| Multi-department blocks | 0% | **72.2%** | |
| Packing (work-hr/block-hr) | 0.82 | 2.06 | **2.51×** |

*This table is checked against the plan artefact by `tests/test_docs.py`; a
stale number fails the build.*

The baseline is not a strawman. It books the same P90 durations the optimiser
books and respects the same line-occupation, resource, per-day and
night-working limits — all asserted by tests. The gap it leaves is structural:
no department can see the other two.

**The optimality bound.** No plan of this work costs less than **30,093,381**
detention-minute equivalents; ours costs 31,883,629 — a **5.61%** placement gap,
proven by the solver rather than claimed.

---

## How it fits together

```
 engine/  (Python, offline)                     web/  (Next.js, static)
 ─────────────────────────                      ───────────────────────
 synthetic backlog                              /dashboard the week at a glance
   → 3 models price every task      plan.json   /planner   comparison screen
   → current-practice baseline    replan.json   /plan      printable block plan
   → monthly allocation          monthly.json   /monthly   the month ahead, checked
   → CP-SAT joint solve          ──────────────▶/replan    one disruption, re-solved
   → explanations, Pareto, bound        │       /audit     the append-only record
   → replan of one disruption           │       /login     zone → division → post
                                        │       /method /limits /scale /network
                                        ▼
                             supabase/  (PostgreSQL)
                             ─────────────────────
                             plan · 425 posts · stations · audit log
                             row-level security + 16 stored procedures
```

The engine runs offline and writes an artefact. The database serves it,
scoped to whoever is signed in. There is no application server in between.

---

## Access control — the database decides

Every account is a **post**, not a person: five per division, five per zone,
from the Ministry of Railways list of **17 zones and 68 divisions** — 425 in all.

| Post | Sees | Can |
|---|---|---|
| Sr.DEN · Sr.DSTE · Sr.DEE | own division's plan | **submit** it to the DRM |
| Sr.DOM | own division's plan | — |
| DRM | own division's plan | **approve**, or **reject with a reason** |
| PCE · PCSTE · PCEE · PCOM · GM | every division in their zone | — |
| any post of another zone | **nothing** | — |

These rules live in PostgreSQL, not the browser. Every table has row-level
security and the client cannot read one directly; the whole API is 16
`SECURITY DEFINER` functions that take the caller's credential and return only
what that post may see. Passwords are bcrypt-hashed. Every transition writes to
an append-only audit log, and the officer who submits can never be the one who
approves.

**Every plan carries a fingerprint** — a SHA-256 of the blocks and tasks it
grants, printed on the issued document. Submission and approval each write it
into the audit log, which nothing can revise, so the plan that was approved is
recorded as it was approved. The planner recomputes it from the plan on screen
and says plainly if the two ever disagree. Status and approver fields are
outside the hash, so moving through the approval chain does not change it.

**When the week does not go to plan** — `/replan`. A USFD flaw found on
Wednesday morning must be removed within 24 hours, and Thursday is a blackout
day. The replan freezes what has already run, then, in order: keeps every
statutory job it can, changes the fewest approved jobs, and is cheapest. On the
shipped week the flaw goes into a block already granted, 7 of 10 approved
blocks are untouched, and one statutory job is deferred — proven unavoidable.
It then re-solves with one more of each resource the flaw needs: **one more
gang and nothing is lost, with no approved job changed at all**; one more USFD
unit does not help. One disruption, precomputed offline; live replanning is not
built.

**Weekly and monthly** — `/monthly`. The month allocates 360 jobs to weeks
(66 · 62 · 30 · 5 jobs in weeks 1-4) with all 139 statutory jobs placed, and then checks
itself: week 1 goes to the weekly solver unchanged, which fits **60 of
66** to the minute. The 6 it cannot place roll forward and weeks 2-4 are
re-planned with them. The month starts from the planner's own week of backlog,
id for id.

`web/scripts/check-auth.cjs` proves it by attacking it — **52 checks**,
including a DRM of a *different* division trying to approve this one's plan.

---

## Running it

### 1 · The web app, no database — two minutes

```bash
cd web
npm install
npm run dev              # http://localhost:3000
```

With no database configured the app runs in **offline demonstration mode**:
sign-in is checked in the browser against the published directory, and the
planner draws the engine's own artefact, scoped the same way the database
would scope it. Every page in this mode says so. Nothing is enforced — that
needs step 2.

### 2 · With the database — Supabase

1. Create a Supabase project.
2. In its SQL editor, run every file in `supabase/migrations/` **in numeric
   order**, `0001` through `0011`.
   `0003b_seed_stations.sql` is 1.8 MB and the editor will refuse it; instead
   run `cd web && npx tsx scripts/build-stations-csv.ts` and import the
   resulting `supabase/stations.csv` into the `stations` table.
3. `cp web/.env.example web/.env.local` and fill in the project URL and the
   **publishable** key. Never the service-role key — it bypasses row-level
   security entirely.
4. Verify: `cd web && node scripts/check-auth.cjs` should report 52 passed,
   and `npx tsx scripts/check-fingerprint.ts` should report 11 passed — the
   fingerprint's properties, the seed agreeing with the library, and the
   database agreeing with both.

### 3 · The engine

```bash
pip install -r requirements.txt
python -m pytest tests -q                              # 185 tests
python -m engine.build_plan --tasks 90 --time 90       # writes web/public/data/plan.json
python -m engine.build_replan                           # writes web/public/data/replan.json
python -m engine.build_monthly                          # writes web/public/data/monthly.json
cd web && npx tsx scripts/build-seed.ts                # refreshes the plan seed SQL
```

Trained models ship in `model_store/`, so the plan builds without retraining.
To retrain: `python -c "from engine.models.pricing import train_all; train_all()"`.

### 4 · Deploying — Vercel

1. Import this repository into Vercel.
2. Set **Root Directory** to `web` in the project settings. This is required:
   there is no `vercel.json`, and Vercel detects Next.js inside `web/` on its
   own. (There used to be one. It said `cd web` while the Root Directory had
   already put the build inside `web/`, so the first real deploy failed looking
   for `web/web` — two descriptions of where the app lives, disagreeing.)
3. Add the two variables from `web/.env.example` under the project's
   environment variables, then **redeploy** — `NEXT_PUBLIC_` values are baked
   in when the site is built, so adding them does nothing to a build that
   already exists. Without them the site runs in offline demonstration mode.
4. Nothing to edit afterwards: `web/lib/site.ts` reads Vercel's own production
   address for canonical links, the share image, robots and the sitemap. On
   any other host, change the fallback address in that one file.

### Demo accounts

Pick **Zone → Division → Post** on `/login`; the form fills itself. Every post
uses the demonstration password `block@2026`, printed on the sign-in page.

- **East Coast Railway → Waltair → Sr.DEN** — the one division with a solved plan
- **East Coast Railway → Zone headquarters → GM** — all three divisions, with a picker (database mode)
- **Northern Railway → Ambala → any post** — a real post with no plan behind it

---

## Repository layout

```
engine/
  core/         schema · activities · stations · corridor · traffic · candidates · synthetic
  solver/       model · build · constraints (the eleven, named) · objective · extract · placement · config
  models/       hazard · duration · detention · features · registry · pricing
  baseline/     current-practice simulation · KPIs
  export/       plan_json — the artefact the web app loads
  explain.py    per-block explanations
  pareto.py     the policy-dial sweep
  replan.py     mid-week disruption: freeze the past, statutory first, least change
  benchmark.py  the scale ladder
  build_plan.py   CLI: the plan artefact
  monthly.py    the month: which week each job goes in
  build_replan.py CLI: the replan artefact
  build_monthly.py CLI: the month, week 1 checked, the rest rolled
tools/          extract_traffic.py — published timetable → engine/core/traffic.py
model_store/    the three promoted models and their cards
tests/          185 tests — one per constraint, plus a doc-drift guard
supabase/
  migrations/   schema · row-level security · seed · credentials · approval chain
web/
  app/          /  /login  /dashboard  /planner  /monthly  /plan  /replan  /audit  /method  /limits  /scale  /network
  components/   charts · heat canvas · Gantt · corridor map · panels · approval · fingerprint
  lib/          db · session · plan · replan · fingerprint · railways · roles
  scripts/      build-seed · build-stations-csv · check-db · check-auth · check-fingerprint
docs/           LIMITATIONS · IMPLEMENTATION · PITCH · ROADMAP
```

---

## The optimiser

One CP-SAT model decides, jointly for all three departments: which candidate
windows to grant, how long each block runs, which tasks go inside it and when,
and what to defer. Every constraint has a test that fails without it.

They are named the way a division says them, with the model's own identifier
kept alongside. These are descriptions of what each constraint does — **not
citations of the General and Subsidiary Rules.** We have not checked them
against that rulebook, so we do not label them as though we had.

| Constraint | What it holds |
|---|---|
| **Sanctioned window length** | A granted block runs at least the minimum the corridor policy allows and no longer than its window; an ungranted one has zero length. <sub>C1</sub> |
| **One sanction per work item** | Each task is placed in exactly one block, or it is deferred and priced as deferred. Nothing is half-scheduled. <sub>C2</sub> |
| **Statutory obligation** | Criticality-A work is a hard constraint, solved first. A feasible plan is therefore a proof that every obligation is met, not a claim that the penalty was set high enough. <sub>C3</sub> |
| **Due-date compliance** | Statutory and scheduled work finishes on or before the date it is due. <sub>C4</sub> |
| **No sanction without work** | A block is granted only if a task uses it. The line is never closed for nothing. <sub>C5</sub> |
| **Protection and clearance** | Work starts only after protection is complete and ends before clearance begins. A block does not start when the gang starts. <sub>C6</sub> |
| **Line occupation and power-block coupling** | No two blocks hold the same road at once, and a section-scope window enters both roads at once - OHE work takes the section down and pays detention on both. <sub>C7</sub> |
| **Machine and gang availability** | One tower wagon, one tamper, two USFD units, gangs and crews, shared across the division. The single tower wagon is the classic binding constraint, and the model finds it without being told. <sub>C8</sub> |
| **Blocks per section per day** | A cap on how often one section is taken in a day - controller workload and caution-order churn, not track capacity. <sub>C9</sub> |
| **Night-working limit** | A cap on night blocks per section per week, because night working is rationed by gang welfare rules and not only by traffic. <sub>C10</sub> |
| **Technological sequence** | Work that must follow other work does: the USFD test precedes the rail renewal it justifies. <sub>C11</sub> |

The objective's last term is the point of the system:

```
− α_C · B · Σ e_w        e_w = extra departments sharing block w
```

It is the one quantity no single department can see or express when it bids
for its own block. Solves are **deterministic**: the budget is solver work, not
wall-clock time, so the same input always produces the same plan.

Protected paths are measured from the published timetable — four premium
services the model is structurally unable to draw a block across.

---

## The three models

All three are scikit-learn, and each has a promotion gate that can fail.

| Model | Method | Result |
|---|---|---|
| Hazard | Discrete-time survival: person-period expansion, logistic link | Concordance 0.690 · prices an overdue rail **109×** a fresh signal lamp |
| Duration | Gradient-boosted quantile + **split-conformal calibration** | P90 coverage **0.870 raw → 0.921 calibrated** |
| Detention | Gradient-boosted regression with neighbour-section features | MAE 5.00 vs naive 26.06 · skill 0.808 |

Without the conformal step, blocks return late roughly one time in eight. The
consequence table is a **published policy input, not a learned parameter** — it
is where railway judgment enters, and it is meant to be argued with.

---

## What we do not claim

`docs/LIMITATIONS.md` and the `/limits` page set this out in full.

- **The maintenance backlog is generated.** TMS, SMMS, TDMS, COA and BDMS have no
  external access. Declared in the interface, the artefact and the printed plan.
- **The models train on generated data**, which bounds what their validation is
  worth. Hazard concordance 0.690 is modest, and we say so.
- **The detention cost shape is assumed.** The published timetable is ingested
  and sets the protected paths and the night window, but the model that prices
  the plan still uses a hand-set daily curve - one the timetable contradicts.
- **One division is solved.** The other 67 resolve to real posts with no plan
  behind them, and the app says so rather than relabelling Waltair's numbers.
- **Statutory is 30/35.** Five tasks cannot be placed, every one behind the
  single tower wagon, and the shortfall list names that constraint against each.
- **Scale is measured, including where it fails.** Given two minutes, the plan
  is good at the 90-task reference size and degrades fast beyond it: at
  1,000 tasks it is still feasible but places only 46 of them. From
  2,500 tasks no solution is found.
- **The optimality gap** is 5.6% on placement and 34.7% including the choice of
  what to defer. Both are root-LP bounds and do not improve with more time.

This is a planning system, not a safety system. It does not touch signalling or
interlocking and it does not grant blocks — BDMS remains the system of record.

---

## Data sources

| Data | Source | Licence |
|---|---|---|
| Station master — 8,697 stations with coordinates | [DataMeet `railways`](https://github.com/datameet/railways) | CC0 |
| Passenger timetable, distilled to section traffic | DataMeet `railways` | CC0 |
| Zones and divisions — 17 and 68, with HQ and year | Ministry of Railways, *List of Zones & Divisions* | public |
| Maintenance backlog | **generated** — seed 7, distributions published in the code | — |

The timetable sets the protected paths and the limit on the night window. It
is **not** yet what the plan's detention costs are priced from: the detention
model still carries an assumed daily shape, which the timetable contradicts.
`docs/LIMITATIONS.md` §1b.

---

## Licence

Code released under the [MIT Licence](LICENSE). The data above keeps its own
terms.
