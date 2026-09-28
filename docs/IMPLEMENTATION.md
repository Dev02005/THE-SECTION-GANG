# Corridor — how it is built

How the system works, where each part lives, and why it is built that way.
Every path below is a file in this repository. Anything designed but not built
is marked **(designed, not built)** where it appears, not gathered at the end
where it is easy to miss.

> **Rewritten 28 Sep.** The previous version was the design document written
> before the build. It named files that were never created (`adapters/`,
> `cpsat_model.py`, `api/auth.py`, `fieldapp/`), models that were never trained
> (LightGBM, an ST-GNN), HTTP endpoints with no server behind them, and one
> test result - "`tests/test_adapters.py` 9/9 pass" - for a test file that does
> not exist. That is the failure this project exists to avoid, sitting in its
> own documentation. The design reasoning was sound and is kept; the claims
> are now checked against the code.

---

## 1. Scope

**What it does.** Takes the maintenance backlog of three departments —
Engineering (P.Way), S&T and Traction Distribution — with the corridor policy
and the train service, and produces one coordinated weekly block plan: for
every block, which section and road, when it starts, how long it runs, and
which tasks from which departments go inside it. One reference corridor is
solved: Waltair division, Duvvada to Vizianagram, four sections, 55 km.

**What it does not do.** It does not replace the divisional block meeting; it
produces the proposal the meeting amends. It does not grant blocks; BDMS
remains the system of record. It does not touch signalling or interlocking,
and no output of it is safety-critical in the interlocking sense. It does not
plan rolling stock.

**The governing idea.** Every block is a purchase. It spends line capacity -
train detention - and buys risk reduction. Both sides are priced in one unit,
**detention-minute equivalents**, so one model can trade them against each
other across all three departments. We do not rank tasks; we price them.

---

## 2. The layers, as built

| Layer | What stands in it | Where |
|---|---|---|
| Source systems | TMS, SMMS, TDMS, COA, BDMS have no external access. A generator stands in for the backlog; the passenger timetable and station geometry are real | `engine/core/synthetic.py` · `tools/extract_traffic.py` → `engine/core/traffic.py` · `engine/core/stations.py` |
| Canonical model | Pydantic types the optimiser sees, and one activity table | `engine/core/schema.py` · `engine/core/activities.py` |
| Prediction | Three scikit-learn models, gated and versioned | `engine/models/` |
| Optimisation | Candidate windows, one CP-SAT model, the bound, explanations, the trade-off sweep, the replanner | `engine/core/candidates.py` · `engine/solver/` · `engine/explain.py` · `engine/pareto.py` · `engine/replan.py` |
| Artefact | Everything the screen needs, written once | `engine/export/plan_json.py` → `web/public/data/plan.json` |
| Record | Plans, posts, approvals and the audit log, behind row-level security | `supabase/migrations/0001`–`0011` |
| Application | Static Next.js pages | `web/` |

The engine runs offline and writes artefacts. A seed script loads the plan
into Postgres. The web app reads it through scoped database functions and
falls back to the artefact when no database is configured. There is no
application server.

---

## 3. The canonical model

**The optimiser never sees a department-specific field.** The three source
systems differ in schema, asset identifiers, what a "task" is, and how often
they update. If any of that leaks into the optimiser it cannot be extended to
a fourth department or a second division.

`engine/core/schema.py:Task` is what every department's work becomes:

```
tid, dept, section, line, km        where
activity, criticality, due_slot     what, how binding, by when
hazard, consequence                 what it risks, priced in section 4
resources                           {resource: quantity}
needs_power_block, needs_disconnection
predecessors                        technological sequence
schedule_driven                     no failure history: priced from its schedule
```

**One activity table.** `engine/core/activities.py` holds each activity's
duration, resources, hazard, consequence and asset type. It exists because
there used to be three copies - the task generator, the duration model and the
pricing module each carried their own - and they drifted until the model was
booking 179-minute jobs into a corridor that allows 150. Nothing was wrong in
any one file; they disagreed. An unknown activity now raises instead of
defaulting.

**Adapters (designed, not built).** One per source system, transport chosen
per site: REST where the source has an API, change-data-capture on a replica
where it does not, and a CSV drop with a manifest and a SHA-256 per file as
the fallback - a half-written CSV looks exactly like a complete one, so a
checksum mismatch is quarantined, never ingested. The canonical asset key
would round chainage to 10 m, because TMS records km 47.213 where TDMS records
47.21 for the same place.

**Point-in-time features.** Training on an event of date D must use only what
was known on D; training on values known later gives excellent offline metrics
and useless field performance, silently. `engine/models/features.py:PointInTimeStore`
enforces it - every read carries an as-of date and never returns a later
value, and a test holds that. Nothing trains through it yet, because nothing
here trains on field history; it is the store a real pipeline has to use.

---

## 4. The three models — the whole role of ML here

All three exist to turn something heterogeneous into a number the optimiser
can compare. All three are scikit-learn; each has a promotion gate that can
fail, and a failed model is kept for inspection but never promoted. Live
metrics travel in `plan.json` under `provenance.modelMetrics`.

### 4.1 Hazard — prices risk (`engine/models/hazard.py`)

Discrete-time survival: person-period expansion with a logistic link, which
is a legitimate survival formulation rather than an approximation of one. The
per-slot cost of leaving a task undone is

```
ρ = ⌈ C · λ ÷ slots-per-day × scale ⌉
```

where λ is the model's daily hazard and **C, the consequence of a failure in
detention-minutes, is a published policy input, not a learned parameter**
(`CONSEQUENCE_MINUTES`). It is where railway judgment enters, and hiding it in
model weights would make the plan's priorities unauditable. An asset with no
failure history is priced from its schedule and flagged `schedule_driven`, so
the screen can say so.

Gate: concordance in [0.60, 0.95] - above 0.95 is treated as leakage - and
positive Brier skill over the base rate. Shipped: concordance **0.690**.

### 4.2 Duration — prices time (`engine/models/duration.py`)

Quantile regression (`GradientBoostingRegressor`, loss `quantile`) at P50 and
P90, then **split-conformal calibration**. The raw P90 covered only **0.870** -
blocks would return late about one time in eight. Adding the held-out residual
quantile brought coverage to **0.921** at a padding ratio of 1.23, with no
tuning. A block returned late holds trains; one returned early costs a few
idle minutes, so the asymmetry is the right one.

Features: activity, quantity, department, section, distance from the nearest
station (access dominates short jobs), gang, machine involvement, and **whether
the block is clubbed** - the optimiser's objective rewards clubbing, so a
duration model blind to it would misjudge exactly the plans the optimiser
prefers.

Gate: P90 coverage in [0.86, 0.94], P50 in [0.44, 0.56], padding under 1.60.
Validated on coverage, not MAE: a model accurate on average but late one time
in eight is not admissible.

*Data hazard for a real deployment:* BDMS records the block, not the work, so
a two-hour block holding one 40-minute job labels that job two hours. Train
on task-level returns or on single-task blocks, and state the bias.

### 4.3 Detention — prices capacity (`engine/models/detention.py`)

`HistGradientBoostingRegressor` on own-section and **neighbour-section** path
density, a goods forecast, road and time. Shipped: MAE **5.00** against a
naive **26.06**, skill 0.808; gate skill ≥ 0.30.

**Its input density is assumed, not measured.** The model builds the surface
from `path_density`, a hand-set daily curve. The published timetable is
ingested and contradicts that curve on this corridor, but the model does not
read it yet, so the shipped plan is priced on the assumed shape. Declared in
LIMITATIONS §1b, and the fix - train and serve on the measured densities - is
recorded there.

**ST-GNN (designed, not built).** Blocking SEC-02 backs traffic into SEC-01
and starves SEC-03; message passing over the section graph can see that and a
per-section regression cannot. The GBM is given neighbour features precisely
so that a future GNN would have to beat a fair baseline. An unjustified GNN is
worse than a justified GBM.

### 4.4 Registry (`engine/models/registry.py`)

Every model is versioned under `model_store/<name>/<timestamp>/` with a
`card.json`, and the promoted version is named in a plain-text `current.txt` -
not a symlink, which fails on Windows. The versions in use are stamped into
every plan.

---

## 5. The optimiser (`engine/solver/`)

### 5.1 Candidate windows (`engine/core/candidates.py`)

Corridor policy gives each section a mid-day and a night window. Candidates
start on a 60-minute grid (`Corridor.START_STEP_MIN`) in three scopes: UP, DN
and SECTION. Two filters at generation, the cheapest place to enforce them:

- **Protected paths** - four real premium services, measured from the
  timetable. A window is **clipped** to end before one, not dropped: a
  01:00-05:00 night window with a Duronto at 03:30 becomes 01:00-03:30, which
  is what a division does. (It used to be dropped, which silently deleted every
  night window once the paths were real.)
- **Blackout days** - no windows at all.

Fixing start times makes detention an exact array lookup on duration rather
than a nonlinear term. `feasible_pair` then drops (task, window) pairs that
cannot fit the window's cap or finish by the due date - an exact reduction,
91% of variables at division scale, with a test that solves without it and
checks nothing the solver used was dropped. The reference instance: 4
sections, 90 tasks, **432 candidate windows, 2,728 assignment variables**.

### 5.2 The eleven constraints

Named in `engine/solver/constraints.py`, one source for the shortfall list,
the artefact, `/method` and the README, and each with a test that fails
without it. They are described the way a division speaks, and deliberately
**not** labelled as General and Subsidiary Rules citations - we have not
checked them against that book. Three carry the most domain weight:

- **C7, line occupation.** No overlap per road, with SECTION windows entering
  both roads' sets - one line of code that encodes the power block: OHE work
  takes the section down, pays detention on both roads, and forbids any other
  block on either.
- **C8, machines and gangs.** Cumulative over the tower wagon, tamper, USFD
  units, gangs and crews. The single tower wagon is the binding constraint,
  and the model finds that without being told.
- **C6, protection and clearance.** Work starts after protection is complete
  and ends before clearance begins. A block does not begin when the gang does.

### 5.3 Objective (`engine/solver/objective.py`)

```
minimise  α_R · Σ ρ_t · τ_t                    risk carried in the horizon
        + α_R · Σ ρ_t · (T+Δ) · (1−z_t)        risk of deferring past it
        + α_D · Σ tbl_w[δ_w]                   train detention
        + α_F · K · Σ G_w                      fixed overhead of any block
        − α_C · B · Σ e_w                      clubbing reward
```

`e_w` counts the *extra* departments in block w. It is the one quantity no
single department can see or bid for through BDMS, and the point of the
system. The four weights are recorded in every plan and shown on the planner;
they are **not** live sliders, because nothing re-solves in the browser. What
moving the risk weight does is measured instead - `engine/pareto.py` re-solves
at seven values and the planner draws the resulting curve, dominated points
included.

### 5.4 Solve, and when it cannot all fit

```
solve(hard_statutory=True)   -> a feasible plan PROVES every obligation is met
  if INFEASIBLE:
solve(hard_statutory=False)  -> a plan plus a shortfall list
```

The shortfall names each statutory item that could not be placed, its priced
risk and the binding constraint. The shipped plan is on the second branch: 30
of 35 statutory items, and all five misses behind the tower wagon. That list
is the paper a DRM takes to the zonal meeting; an optimiser that only says
"infeasible" is useless in an operating railway.

### 5.5 Determinism (`engine/solver/model.py`)

A wall-clock limit is not deterministic even with `interleave_search`: the
clock truncates the search wherever the machine happens to be. The shipped
solve uses `max_deterministic_time` - a work budget - with a fixed seed, so
the same input gives the same plan and only the wall time varies. A test
hashes the whole artefact across two runs.

### 5.6 The bound (`engine/solver/placement.py`)

The full objective is ~99% deferral penalty, so its gap (34.65%) measures how
many deferrals are provably necessary. Pinning the scheduled set and
re-solving answers the question a planner asks - is this work placed well? -
with a gap of **5.61%** and a floor of **30,093,381**. Both are root-LP bounds
that do not improve with time; the floor, not a percentage, is what the screen
leads with.

### 5.7 Scale

Measured, including the rungs where it fails, in `engine/benchmark.py`; the
table is in LIMITATIONS §7 and on `/scale`. Decomposition by section is
refused on purpose: the tower wagon couples the sections, and a
section-by-section solve double-books it.

### 5.8 The monthly horizon (`engine/monthly.py`, `engine/build_monthly.py`)

A month is planned a level up: which week each job goes in, and how much
corridor each section needs that week. The same job cannot be scheduled to the
minute over 28 days at this scale, and a division does not plan a month that
way either. Each monthly rule is a coarse form of a weekly one - a job only in
a week some window can take it by its due date (the weekly `feasible_pair`,
used as is); corridor time per section-week from the real windows, four nights
at most; at most as much simultaneous work on a resource as there are units;
each resource's weekly hours within one block per corridor per day; and work
held to 1.2 work-hours per block-hour, the packing the weekly solver
achieves on a full week. Priced in the same unit, with the same penalties.

The builder then does what makes a monthly plan worth having: it hands week 1
to the weekly solver unchanged, records how much fits (60 of
66), and re-plans weeks 2-4 with what did not.

---

## 6. Explanations (`engine/explain.py`)

A true counterfactual re-solves with one decision pinned. That was measured,
on an earlier build of the reference instance: forbidding any single block
was **infeasible** under hard statutory rules - every block load-bearing - and
each re-solve took about 25 seconds. Too slow to run while a judge waits, so explanations are
exact accounting over the solved plan, precomputed:

- **What did sharing save?** The same jobs, each in the cheapest window it
  could have used alone, against their cost together. The alternative gets its
  best case, so a saving is a floor. When sharing costs more - a section block
  pays both roads - the headline says so and states the net; a test holds it
  to that.
- **What did this slot cost?** The block against the cheapest window of the
  same length. Often unflattering, and shown anyway.

**Capacity slider and priced override (designed, not built).** Raise the
corridor cap and show which arrears clear; let a planner move a block and
show what the move costs rather than refusing it. Both need a live re-solve.

---

## 7. Replanning (`engine/replan.py`)

One mid-week disruption, re-solved from the approved plan:

1. Blocks already worked are **frozen** exactly as they ran; freezing fails
   loudly if an executed assignment has no variable to pin.
2. The new defect is **required**, not priced: dealt with by its deadline, or
   the replan returns infeasible and says so.
3. Then three solves, each holding the one before: keep the most statutory
   jobs; change the fewest approved jobs; be cheapest. Each starts from a
   hint - the approved plan, then the previous stage's answer.
4. Re-solve with one more of each resource the defect needs, and report which
   would have avoided the loss.

A weighted single-objective version was built first and kept none of the
approved blocks; the tests include one that fails on that. `engine/build_replan.py`
refuses to write its artefact unless the plan it rebuilds reproduces the
shipped objective and block count exactly. **Continuous replanning (designed,
not built)** - watching a defect feed and re-solving on its own - needs feeds
this project does not have.

---

### 7.1 Eight disruptions (`engine/build_replan.py`)

`urgent_job` builds any activity in the vocabulary as the emergency, with its
department's physical rules - a traction job needs a power block over the
section, an S&T job a disconnection. The builder runs 8 of them against the
approved week: three kinds of fault, on different sections, days and deadlines.
One that cannot be met by its deadline would be kept and said plainly, with the
resource that would make it possible; on this week all 8 are met.

## 8. The record and the application

**Postgres is the system of record** (`supabase/migrations/`). Every table has
row-level security and the client can read none directly; the API is 16
`SECURITY DEFINER` functions that resolve the caller's post and return only
what it may see. Posts, not people: 425 of them, five per division and five
per zone, from the Ministry list of 17 zones and 68 divisions.

**The approval chain.** Sr.DEN, Sr.DSTE or Sr.DEE submits; only that
division's DRM approves or rejects, and a rejection needs a reason. Every
transition is written to `audit_log`, which has no update or delete policy. A
re-solve supersedes earlier plans rather than deleting them. Each plan carries
a SHA-256 **fingerprint** of what it grants (`web/lib/fingerprint.ts`, one
implementation for the seed and the browser), written into the audit log at
submission and decision and printed on the document.

**Pre-approval checks** (`engine/validate.py`). 12 checks re-verify the
published plan - the artefact, not a re-solve - against every hard rule, sharing
no code with the solver's model. `build_plan` refuses to write a plan that fails
one; `build_checks` writes the result beside the plan, and the site holds Submit
and Approve unless a passing set belongs to the plan on screen.

**The web app** (`web/`) is static Next.js: `/dashboard`, `/planner` (the
comparison - current practice above, the joint plan below, detention heat
strip behind both), `/plan` (the issuable A4 document), `/replan`, `/audit`,
and `/method`, `/limits`, `/scale`, `/network`. Charts are hand-built: Canvas
for the heat strip, SVG for blocks, with a roving tabindex so the chart is one
tab stop and arrow keys move between blocks.

**Designed, not built:** a read-only controller view with blocks over the
train graph; reading block-taken and block-returned times back from the
Station Master's Train Signal Register, which would give the duration model
real labels; BDMS write-back as demands, never writes to the block register;
on-premises deployment inside RailNet with sign-in against HRMS rather than a
user table of our own.

---

## 9. Testing (`tests/`)

| File | What it holds |
|---|---|
| `test_constraints.py` | One test per constraint C1–C11, each built so that constraint alone prevents an obviously better answer |
| `test_core.py` · `test_geometry.py` | Schema, candidate generation, protected-path clipping, and chainages recomputed independently |
| `test_models.py` | The gates pass on good data and fail on plausibly bad data; the point-in-time store never looks ahead; pricing is identical across separate interpreters |
| `test_baseline.py` | The baseline books the same durations and obeys the same limits as the optimiser; the artefact is reproducible |
| `test_placement.py` · `test_explain.py` · `test_pareto.py` | The bound's restriction travels with it; explanations quote only real numbers; dominated points are kept |
| `test_replan.py` | Properties of any replan: the past frozen, the defect required, disruption minimal and reported as found |
| `test_benchmark.py` | The variable filter is exact; larger instances keep contiguous, named sections |
| `test_validate.py` | The shipped plan passes all checks, and each check fails when its one rule is broken on a copy of it |
| `test_monthly.py` | Every job in a week it can be done; corridor, packing and resource limits held; one tower wagon never in two places; a job waits for its predecessor; deterministic |
| `test_docs.py` | Numbers stated in the docs match the artefacts, including the test count itself |

The web side is checked against the live database by
`web/scripts/check-auth.cjs` (scoping, writes, the approval cycle) and
`web/scripts/check-fingerprint.ts`.

---

## 10. Acceptance criteria, against what was measured

Both plans scored by one function on one instance.

| Criterion | Target | Measured |
|---|---|---|
| Work-hours per block-hour | > 1.5× baseline | **2.51×** (0.82 → 2.06) |
| Detention per task completed | > 30% lower | **−56.5%** |
| Statutory items closed | all where feasible, shortfall where not | **30 of 35**, five named behind the tower wagon |
| P90 duration coverage | 88–92% | **92.1%** - inside the gate, 0.1 point over the target |
| Weekly plan generation | < 60 s | **not met**: about 90 s under the deterministic budget |
| Same input, same plan | always | **met**: artefact hashed across runs |
| Blocks returned late | < 10% | **not measurable** without block-return data |

---

## 11. Rollout (designed, not built)

1. **Historical replay** - six months of one division's past data, no live
   use. Where the data-quality problems surface.
2. **Shadow mode** - a plan every week beside the real process, acted on by
   nobody, so officers see it be right or be wrong in ways they can explain.
3. **Advisory pilot** - one division; the plan is the meeting's starting
   proposal, and every override is logged with its reason.
4. **Adoption** - the default, overrides still logged.
5. **Scale** - further divisions, retrained per division. The detention
   surface in particular does not transfer.

## 12. Risks

| Risk | Mitigation |
|---|---|
| BDMS records blocks, not tasks | Task-level returns from the Train Signal Register; single-task blocks meanwhile, with the bias stated |
| Source systems have no API | CDC on a replica, or a CSV drop with a manifest - chosen per site |
| Asset identity does not reconcile | Canonical asset key and a maintained reconciliation table; report the unmatched rate |
| Does not scale to a division | Measured: feasibility fails before division scale. Coarser grid, rolling horizon, allocation at zone level |
| Officers do not trust the plan | Shadow mode, per-block explanations, priced rather than refused overrides |
| The consequence table is contested | It is a published policy input, meant to be argued with |
