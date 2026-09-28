# Limitations, assumptions and data provenance

Written before anyone asked. A system that declares what it does not know is
easier to trust than one that waits to be caught.

Every number this system displays is computed by code in this repository from
the data described below. Nothing is a constant chosen to make a chart look
good, and both sides of every comparison are scored by one function on one
instance.

---

## 1. The data is synthetic, and that is not a choice

TMS, SMMS, TDMS, COA and BDMS are internal Indian Railways systems. They have no
external access, no public API and no published extract. **The maintenance
backlog in this system is generated, not observed.**

That is a hard constraint on any entrant, not a shortcut we took.

### What is grounded in published practice

| Element | Basis |
|---|---|
| Corridor structure | Two windows a day — a mid-day and a night corridor — as most divisions run |
| Blackout days | Festival traffic bans and monsoon patrolling intensification |
| Activity durations | RDSO Track Machine Manual working norms and typical divisional gang strengths |
| Resource pool | One tower wagon, one tamper, two USFD units, three P.Way gangs, two S&T and two TRD crews — a realistic divisional establishment |
| Consequence table | Published as a policy input, not learned — see §3 |

### What is real, and measured rather than asserted

**The corridor geometry.** The five stations — Duvvada, Kottavalasa,
Kantakapalle, Alamanda and Vizianagram Jn — are real, and the section
boundaries are **computed** from their published coordinates (DataMeet
`railways`, CC0) by `engine/core/stations.py`. They used to be hand-written,
duplicated across two files, and wrong: the line is 55 km, not the 78 km we
asserted.

**The traffic** — from the published passenger timetable. It is measured, but
the detention surface the shipped plan is priced with does **not** use it yet;
§1b says exactly what does. **The protected paths** — four real premium
services with their real transit times, replacing two invented slots. These do
reach the plan. Both are set out in §1b, including what they exclude.

**Zones, divisions and the station master** — from the Ministry list and the
CC0 geodata. These are reference: they name things, and they do not reach the
optimiser.

### What is invented

The specific defects, their chainages within a section, their due dates, the
condition history behind each hazard estimate - and the daily shape of
detention cost that the shipped plan is priced with (§1b). The generator, its seed and its target
distributions are in `engine/core/synthetic.py` and
`engine/core/activities.py` so they can be argued with.

### What this means for the numbers

The **structure** of the result is defensible: clubbing reduces block count
because three departments genuinely cannot see each other's registers, and
that is a property of the problem, not of our data. The **magnitudes** are as
good as the generator. A different backlog would give different percentages.

---

## 1b. Traffic is measured - and the priced plan does not use it yet

The published passenger timetable is ingested: **480 directional section
traversals by 114 trains** that stop at two or more of this corridor's
stations, weighted by train class and spread across the weekdays each service
actually runs (`tools/extract_traffic.py` -> `engine/core/traffic.py`).

**The data contradicts our assumption, and that is worth stating.** We assumed
06:00-10:00 and 17:00-22:00 were the two expensive passenger peaks and the
mid-day window the cheapest of the day - and the pricing still does (next
subsection). On this corridor those
peaks are among the *quietest* hours, and midnight is the busiest - long
distance trains on the Howrah-Chennai route pass Waltair overnight. Only the
night-corridor assumption survived: 02:00 really is quiet. Nationally the
distribution is flatter still, every hour carrying 3.5% to 4.4% of all stops,
because Indian Railways runs around the clock.

### What the shipped plan is actually priced with

**Not the measurement.** The shipped plan is model-priced, and the detention
model builds its surface from `path_density` in `engine/models/detention.py`:
a hand-set daily curve that prices 06:00-10:00 and 17:00-22:00 as the peaks
and mid-day as the cheapest, multiplied by a random per-section "busyness".
That is exactly the assumed shape the timetable contradicts. The measured
traffic reaches the instance's own surface, which the scale benchmark and the
tests solve against, but pricing replaces that surface before the shipped
plan is solved.

So the heat strip on the planner, every detention figure and where each block
sits all rest on the assumed shape. In the shipped plan, the timetable decides
two things: the four protected paths, and the 03:30 end of the night window
(both below).

Found on 28 Sep, while rewriting the implementation document against the code.
Until then this section, the `/limits` page and the notice on every page said
the detention surface came from the timetable. It did not, and the correction
is made here rather than quietly. Making it true means retraining the
detention model on the measured densities and re-solving, which moves every
headline number. Until that is done, the claim is withdrawn.

### Three exclusions, so the figure is a floor rather than a census

| Excluded | Why |
|---|---|
| Trains stopping at only ONE corridor station | Direction cannot be inferred, and guessing would invent traffic |
| Trains passing WITHOUT stopping | Invisible to a timetable of stops |
| **Goods traffic entirely** | The published timetable is passenger only, and freight is roughly half of all movements |

The freight gap is the material one, and it has a name. The **East Coast
Dedicated Freight Corridor** (Kharagpur to Vijayawada, 1,100 km, *proposed*)
would run down this very route and take that traffic off the mixed line. Until
it exists, freight shares these sections with the passenger services we can
see, and a surface built from this timetable cannot price it. Any such
surface is a floor, not the full load.

### Protected paths are measured, and they do reach the plan

Four premium services cross this corridor, taken from the same timetable with
their real transit times. They replaced two invented paths that sat at 07:00
and 16:00 every day and protected nothing that runs.

One of them changes the plan: **12246, the Yesvantpur Duronto, crosses the
01:00-05:00 night maintenance corridor at 03:30-04:01.** The night window is
now clipped to end at 03:30 rather than running to 05:00 - which is what a
division does in practice: take the block, clear before the train.

Making the paths real also exposed a latent bug. The window generator tested a
candidate's *maximum* duration against the protected paths and discarded any
that touched one - but `max_dur` is a cap, not a duration, so a window that
could run 01:00-05:00 was thrown away over a 03:30 train even though a
two-hour block inside it is perfectly legal. With the invented paths sitting
outside both corridors the check never fired. With real ones it deleted every
night window in the horizon. Windows are now clipped rather than dropped, and
four tests hold that behaviour in place.

**Vande Bharat services are NOT protected, and that is declared.** Two run on
East Coast Railway, including Bhubaneswar-Visakhapatnam, which uses this line.
The timetable we hold predates them - none appears in it - so we know the
service exists without knowing its path through our sections. Supplying a
plausible timing would put an invented number back into the one place this
work has just removed them from.

### A note on published national figures

They disagree with each other. The station count is quoted as 8,016 (2023),
7,469 (2025) and 8,697 in the CC0 geodata we hold; one government workbook
gives a total route length of 68,584 km while listing Broad Gauge alone at
70,271 km, which cannot both be true. We quote none of them as our own
metrics. Everything on screen is computed from data in this repository.

---

## 2. The models train on synthetic data

> **Note for maintainers.** The figures below are transcribed from the model
> cards and have gone stale once already. The live values travel in
> `plan.json` under `provenance.modelMetrics` and are what `/limits` renders.
> If the two disagree, `plan.json` is right.


All three models are validated with real methodology on generated data. That
bounds what the validation is worth, and we would rather say so.

| Model | Method | Result | Gate |
|---|---|---|---|
| Duration | Gradient-boosted quantile regression, split-conformal calibration | P90 coverage **0.870 raw → 0.921 calibrated**, padding ratio 1.23 | Coverage in [0.86, 0.94] |
| Hazard | Discrete-time survival (person-period, logistic link) | Concordance **0.690**, positive Brier skill | Concordance in [0.60, 0.95] |
| Detention | Gradient-boosted regression with neighbour features | MAE **5.00** against naive 26.06, skill 0.808 | Skill ≥ 0.30 |

The gates can fail, and tests assert they do on plausibly bad inputs. A failing
model is saved for inspection but not promoted, and the previous version stays
in service.

**What we do not claim.** A concordance of 0.690 on generated survival data
does not establish that the model would rank real assets that well. The
conformal calibration guarantee is a property of the method under
exchangeability — it holds on this data and would need re-establishing on
field data.

**The hazard model is scikit-learn, not a gradient-boosted Cox model.** This
paragraph claimed XGBoost `survival:cox` "where available", with sklearn as a
fallback. The cox branch was never written - there is no `import xgboost`
anywhere in the engine, and the shipped card reads `sklearn-discrete`. What
runs is a discrete-time survival model: person-period expansion with a logistic
link, which is a legitimate formulation rather than an approximation of one,
and it scores a concordance of 0.690.

**`scikit-survival` was evaluated and rejected** for a separate reason: its
`ecos` dependency has no Python 3.14 wheel and will not compile.

---

## 3. Where railway judgment enters, deliberately visibly

The consequence of a failure — how many detention-minutes a broken rail or a
failed point machine actually causes — is **a policy input, not a learned
parameter**. It lives in `engine/models/hazard.py:CONSEQUENCE_MINUTES`, it is
published, and it is meant to be argued with by the division that would use it.

Burying that table inside model weights would make the system's priorities
unauditable. It is the single place where operational judgment is encoded, and
it should be visible.

---

## 4. The optimality gap is wide, and reported anyway

Two numbers, because they answer different questions.

**Placement optimality — 5.6%.** Holding the set of scheduled work fixed, the
schedule costs 31,883,629 against a proven floor of 30,093,381. This is the
question a planner asks: given the work we are doing, is it placed well?

**Including what to defer — 34.7%.** The full objective is roughly 99%
out-of-horizon deferral penalty, so its gap really measures how many deferrals
are *provably* necessary. That is a hard thing to bound.

Both are root-LP bounds. **They do not improve with more solve time** — only
the primal does. We verified this at two work budgets; the floor was identical
both times.

We report the floor rather than headline a percentage: *no plan of this work
costs less than 30,093,381 detention-minute equivalents.* That is a proof. Of
the 28 competing repositories, one computes a bound and none displays it -
searched for every common bound API across all 28, and through that one's web
application.

---

## 5. Statutory obligation: 30 of 35

Five criticality-A tasks cannot be placed, and **every one of them is behind
the same machine**:

| Task | Risk rate | Binding constraint |
|---|---|---|
| TRD-006 | 93/slot | Machine and gang availability (C8) — tower wagon |
| TRD-010 | 150/slot | Machine and gang availability (C8) — tower wagon |
| TRD-011 | 88/slot | Machine and gang availability (C8) — tower wagon |
| TRD-078 | 143/slot | Machine and gang availability (C8) — tower wagon |
| TRD-079 | 106/slot | Machine and gang availability (C8) — tower wagon |

It was one task before the corridor became real. Measuring the traffic and the
protected paths shortened the night window — a Duronto crosses it at 03:30 —
and the tower wagon ran out of night to work in. That is not a regression in
the optimiser; it is the corridor we actually have rather than the one we
assumed.

Each appears in the shortfall list with its binding constraint named. We could
have tuned them away. **Five statutory items stuck behind one machine is the
paper a DRM takes to the zonal allocation meeting** — it is worth more than a
suspiciously perfect result.

---

## 6. What is designed but not built

Named here rather than implied by omission. The `/limits` page carries the
same seven names, and a test fails if the two lists disagree.

- **Reading the Train Signal Register.** The duration model trains on
  generated durations and never improves without field data. The route in is
  the **Station Master**, not a new field app: the SM at each end of the
  section already records block taken and block returned in the Train Signal
  Register, by rule, tonight. Reading those two timestamps back would make the
  duration model the one model grounded in observation, and it asks nobody to
  do anything they are not already doing.
- **Historical replay harness.** Stage 1 of the rollout, where data-quality
  problems surface.
- **BDMS write-back.** The planner proposes; BDMS grants. We never write to the
  block register.
- **ST-GNN detention surface.** A graph is justified, because blocking one
  section backs traffic into its neighbours. But an unjustified GNN is worse
  than a justified GBM, so we ship the GBM and say so.
- **Continuous replanning.** The replanner is built and works on one
  disruption at a time: `/replan` re-solves a mid-week USFD flaw with the past
  frozen, statutory work kept first and the fewest approved jobs changed, and
  names the resource that would have avoided the cost. It runs offline: 8
  scenarios are precomputed and offered as a choice. What is NOT built is the loop around it - watching
  a defect feed and re-solving on its own as things happen. That needs the
  feeds this project does not have.
- **Serving the plan only from the database.** The credential check and the
  scoping are **not** in the browser: `sign_in` compares a bcrypt hash in
  Postgres, and `my_plan` returns a plan only to a post of that division or
  that zone, so an officer of Northern Railway gets null rather than Waltair's
  numbers. That much is real, and it is applied inside the query where the
  client cannot opt out of it.

  What remains open is the **fallback file**. `plan.json` is still served
  publicly at `/data/plan.json`, because the application has to run for anyone
  who clones it without a database. Requesting that URL directly still yields
  the artefact. So the scoping is enforced and the artefact is not, and those
  are two different claims. A deployment would serve the plan only through the
  database and delete the fallback.

  A deployment would also carry no user table. Every officer already has an
  **HRMS employee ID**, and an internal application on RailNet authenticates
  against that directory. A block plan is an auditable document, so "approved
  by Sr.DEN" must resolve to an establishment record rather than a row in our
  database - and local accounts go stale on the next transfer.
- **Un-approving a plan.** No railway un-approves a programme; it supersedes
  it, and supersession is built (§6b). `reset_plan` has no real counterpart: it
  returns the *same* plan to draft, because this instance is shared by
  everyone who opens the site, and without it the approval chain could be
  exercised exactly once. The button says so, and the reset is itself written
  to the audit log.

---

## 6b. The approval chain and the fingerprint - what they prove

**The chain is built** and driven from the planner: draft -> submitted ->
approved, or sent back with a reason and brought again. `submit_plan` accepts
only Sr.DEN, Sr.DSTE or Sr.DEE of that division, `decide_plan` only its DRM, a
rejection without a reason is refused, the officer who submits can never be
the one who decides, and every step writes to an append-only audit log. All of
it is tested by walking the cycle end to end (`check-auth.cjs`).

**Supersession is built** for a new solve: re-seeding marks the division's
previous plans `superseded` rather than deleting them, so a decided plan stays
as the record of what was granted and the audit log keeps pointing at a row
that exists. (Until 27 Sep the seed deleted only rows carrying its own
reference; because the reference contains the generation date, a re-solve on
another day left two current plans side by side.)

**The fingerprint** is a SHA-256 over what the plan grants - every block, the
tasks in it and their slots, and the horizon. It is on the plan row, on the
printed document, and written into the audit log at submission and at
decision. Status and approver are outside it, so moving through the chain does
not change it. What it does and does not establish:

- It proves **integrity, not correctness.** A fingerprint that matches says
  this is the plan that was approved. It says nothing about whether the plan
  is good.
- It is **a hash, not a signature.** Who approved comes from the audit row's
  officer id, and in this demonstration every post shares one password,
  printed on the sign-in page. "Approved by the DRM" here means "approved by
  someone signed in as the DRM".
- It is tamper-evident **against the application's users, not against the
  database owner.** Row-level security stops every client from editing the
  audit log; the project's owner and its service-role key bypass row-level
  security entirely, and could rewrite the plan, its hash and the log
  together. The copy outside our control is the printed one, which is why the
  fingerprint is printed.

**The pre-approval checks** re-verify the published plan against 12 hard rules,
independently of the solver, and gate both `build_plan` and the site's Submit
and Approve. What they do and do not establish:

- They check the plan against **this model's rules**. Those are named the way a
  division says them and have not been checked against the General and
  Subsidiary Rules, so they are not presented as G&SR citations.
- They are enforced by the engine and by the application - **not yet by the
  database**. `decide_plan` does not re-run them, so a post calling the database
  directly could approve a plan the site would hold.
- One check examines nothing on this plan: no job in the generated backlog has a
  predecessor, so "predecessors finish first" reports *none to check* rather
  than a pass it did not earn. It is still tested, on a plan with one.

---

## 6c. The monthly horizon - coarse by design, and checked

**Built on 28 Sep.** `/monthly` allocates a month of backlog to weeks: which
week each job goes in, and how much corridor each section needs that week.
The month starts from the planner's own week - all 90 of its jobs, id for
id - plus three more weeks of backlog behind it, 360 jobs in all.

**It cannot see roads or minutes.** So it is held to the packing the weekly
solver actually achieves on a full week: 1.2 work-hours per block-hour. The
shipped week packs 2.06, but that week is light; a full one packs 1.22. Planned
at 2.0, the month gave week 1 103 jobs and the weekly solver could place 66.
Measured, not chosen.

**Checked, not assumed.** Week 1's allocation is handed, unchanged, to the
weekly solver. Scheduled to the minute it places **60 of 66** (91%). The
6 it cannot place roll into weeks 2-4, which are re-planned with them. 5 of
those 6 are statutory, all behind the tower wagon, and after the roll they are
**overdue** - so the month's "139 of 139 statutory placed" is the monthly plan's
figure, and at minute resolution 5 slip past their due dates.

**What else to know.** Risk is priced over the 28-day horizon, so the same job
carries a somewhat higher price than in the week's plan. 197 of 360 jobs are
deferred out of the month - none statutory: 137 priced out (their risk costs less
than the corridor they would need), 60 with no room (every week they could use
was already full). It is one division, precomputed offline, and served as a
static file beside the plan, as the replan is - not held in the database.

---

## 7. Scale

The reference instance is 4 sections, 90 tasks, 432 candidate windows over a
7-day horizon at 15-minute slots. The shipped plan solves in about
92 seconds under a fixed deterministic work budget.

Measured on 28 Sep across a ladder of instance sizes, each given
120 seconds of free search — the failing rungs included, because a
scale claim without them is a marketing number:

| tasks | sections | assign vars | build | solve | status |
|---|---|---|---|---|---|
| 90 | 4 | 2,728 | 0.2s | 121s | FEASIBLE |
| 500 | 12 | 12,690 | 2.0s | 122s | FEASIBLE |
| 1,000 | 20 | 27,070 | 4.1s | 126s | FEASIBLE |
| 2,500 | 40 | 71,691 | 23.1s | 143s | UNKNOWN |
| 5,000 | 60 | 141,643 | 45.9s | 168s | UNKNOWN |
| 10,000 | 100 | 278,736 | 291.6s | 363s | UNKNOWN |

**Good at the reference size, degrading fast beyond it, feasible to 1,000
tasks, and nothing found from 2,500.** "Feasible" flatters the
1,000-task rung: in two minutes it placed 46 of 1,000 tasks and closed
25 of 385 statutory items. At 10,000 — the size the fastest competing
entry quotes — the model still builds (292 s, 278,736 variables) and
the solver finds nothing in about 6 minutes. That entry reaches 10,000 in
milliseconds because its task struct carries no department field and it does
no clubbing at all, which is a fast solution to a smaller problem rather than
a faster solution to this one.

Quality gives out well before feasibility does: across the rungs that solve,
the share of work placed falls from 86% to 5% and the share of shared blocks
from 77% to 2%, because the search has less time per decision.

The table was first measured on 4 Sep, on an engine the real geometry and
timetable have since changed (576 candidate windows at 90 tasks then,
432 now). It went on being quoted after that. It was re-run on 28 Sep,
and a test now fails if this table and the benchmark file disagree.

Two exact reductions make it fit, neither of which deletes a solution:
assignments that cannot fit a window's cap or finish by their due date are
never given a variable (**91% of variables at division scale**), and the
candidate start grid coarsens, which corridor policy permits anyway.
Decomposition by section is deliberately refused: the single tower wagon
couples the sections, so a section-by-section solve double-books it.

---

## 8. This is not a safety system

It is a planning system. It does not touch signalling or interlocking, it does
not grant blocks, and no output of it is safety-critical in the interlocking
sense. It produces the proposal that the divisional block meeting reviews and
amends.

---

## 8b. The database may not be there, and the application says so

Postgres is the system of record here: it holds the officer directory, the
plan, the approval chain and the audit log, and row-level security is what
makes the sign-in mean anything. None of that is in the browser.

It is also a free-tier project, and on 27 Sep the one behind this build
stopped resolving entirely - NXDOMAIN, not a timeout. Until then the
application treated *configured* and *reachable* as the same thing, so a dead
host did not degrade the site, it broke the front door: every credential came
back "does not match", on the sign-in page, with every page behind it
unreachable. A dead database left the application less usable than no database
at all.

What happens now, and the distinction is the whole point:

- **No database configured.** Offline demonstration mode. The credential is
  checked in the browser against the published directory, and the engine's
  static file is handed out under the same entitlement rule Postgres applies -
  Waltair's own posts and East Coast Railway's zonal posts, nobody else. Every
  page says so.
- **Configured but unreachable.** The same fallback, under a different banner
  that says the record could not be read. The plan's real status, and anything
  another officer has changed, are *unknown* rather than what is drawn.
- **Configured and it refused.** Obeyed. A refusal is an answer - this post may
  not do that, that plan belongs to another zone - and it is never fallen back
  past. Only a transport failure degrades.

What offline mode costs, stated plainly: there is no enforcement. The scoping
is reproduced by the browser rather than applied by Postgres, so it is a
demonstration of the shape and not a security boundary. Nothing can be written
- no submission, no approval - because there is nowhere to write it, and the
audit log shows nothing rather than an invented history.

---

## 9. Reproducibility

Every plan records the instance seed, the model versions, the policy weights,
the solver status and the bound. Deterministic mode fixes the *work* budget
rather than a wall-clock limit — a clock truncates the search wherever the
machine happens to be, which is a subtler source of non-determinism than worker
racing and bit us once. Wall time now varies with load while the plan does not.

A test hashes the whole artefact across two runs and asserts they match,
excluding only `generatedAt` and `wallTimeS`, which are timing measurements by
nature.
