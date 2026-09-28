# Corridor — plan to regain first place

Written 27 Sep 2026, after re-auditing the field. The rival set grew from seven
repositories to **28**, and three claims this project used to make are no longer
true. This is what we do about it.

*(The original 48-hour build plan, `PLAN.md`, was retired on 28 Sep: it still
stated an XGBoost hazard model and a C-index of 0.809 as fact, neither of which
was ever built. Git history keeps it. This file is the plan and the record.)*

---

## What changed in the field

| Claim we used to make | Status |
|---|---|
| "7/7 model no resources at all" | **False.** rail-bloc, RailSync, SIH26027-main and Pashupatastra all model machines or crews. RailSync models resource *outage windows*, which we do not |
| "No rival has a clubbing term" | **False.** 18 of 28 mention it; `sih26027-block-planning (1)` optimises a real joint-block bonus |
| "7/7 report no optimality bound" | **False.** rail-bloc computes `BestObjectiveBound()` |

| Still true, checked across all 28 | Evidence |
|---|---|
| **Nobody displays a proven floor** | rail-bloc computes one and never renders it — its whole web app was searched |
| **Nobody uses conformal calibration** | zero matches in 28 repositories |
| Baseline scored by the same function as the optimised plan | no rival does this as rigorously |

**Honest standing: top three on merit, no longer clearly first.** rail-bloc
matches us on engineering and beats us on safety-rule naming, mapping and plan
integrity. Pashupatastra beats us on volume (91k lines, ~2,200 test functions).

---

## Phase 0 — DONE 27 Sep

**The database was gone and is now back.** `xabdudjhscrqnwgipxwl.supabase.co`
stopped resolving entirely (NXDOMAIN against 8.8.8.8, not a timeout) after
sitting idle since 6 Sep. The team restored the project and ran the ten
migrations; it came back **empty**, 0 of 12 tables, and was re-migrated from
the files in `supabase/migrations/`, which is the first time that path has
been exercised as a stranger would run it.

Measured after: **12/12 tables present**, anonymous row counts zero everywhere
(row-level security doing its job), and `check-auth.cjs` at **52 passed, 0
failed**.

An earlier version of this step said to add `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` to Vercel. Following it *while the host was
dead* would have pointed the live site at nothing and replaced a working
offline demonstration with a sign-in page that rejected every credential. It
is safe now, and it is still the right step - but only against a project that
answers.

Both remaining steps are done: the two keys are set in Vercel for Production
and Preview, and the repository is pushed to GitHub and deployed.

**The application no longer depends on the database being up.** Configured and
reachable are distinguished: an unreachable host degrades to offline mode
behind a banner saying the record could not be read, and only a *transport*
failure does that - a refusal from Postgres is still obeyed. LIMITATIONS §8b.

---

## Phase 1 — constraint renaming · DONE

`C1`…`C11` became names a division would say. One source of truth in
`engine/solver/constraints.py`, reaching the shortfall attribution, the
artefact, the `/method` page and the README.

The line a DRM reads went from `TOWER_WAGON capacity (C8)` to
**"Machine and gang availability (C8) — tower wagon"**.

**Deliberately not labelled `G&SR-n`.** A rival does that; G&SR is a real
rulebook and we have not checked our constraints against it. Both the method
page and the README say so, and a test now fails if anyone adds such a label.

Verified: the artefact was rebuilt with `--no-pareto` and every headline number
is unchanged - objective 36,639,101, proven floor 30,093,381, placement gap
5.61%, the same five shortfall tasks. The Pareto block was carried across only
after diffing the whole artefact and confirming the only other differences were
the two `wallTimeS` measurements. `/method` renders all eleven names with the
disclaimer, checked in the browser.

**A third guard came out of this.** The README stated "148 tests" in two places
while 150 existed. It is a small drift but it is the same bug, so the suite now
reads its own collected count and compares it to the three places the docs
state it - and fails, separately, if one of those statements disappears.

---

## Phase 2 — cheap credibility · ~5 h

| | Feature | Time | Why |
|---|---|---|---|
| 2a | Audit log page | **DONE** | `my_audit` existed and nothing read it. `/audit`, zone-scoped, append-only stated on the page |
| 2b | Plan fingerprint / tamper-evidence | **DONE** | SHA-256 of what the plan grants, on the row, on the printed document, and written into the append-only audit log at submission and approval |
| 2c | Premium-class detention (Vande Bharat / Rajdhani) | **Superseded** | Premium paths are hard constraints, so a premium train is never detained by a block at all - a separate premium KPI would always read zero. The rest of the surface is already weighted by class (superfast 1.5, express 1.0, passenger 0.7) |
| 2d | Dashboard | **DONE** | Every number already computed |

**2a as built.** `/audit` is a third nav link rather than a Docs entry,
because it is this zone's own record and not documentation. It states its own
scope before the rows — `my_audit` is ZONE-wide, so a Sr.DEN of Waltair sees
Khurda Road's entries too, which "my audit log" would not suggest. Append-only
is a checked claim, not a slogan: `audit_log` has a select policy and an
insert policy and no update or delete policy, and no routine in the schema
edits a row.

**Verified against real rows**, once the database came back: 73 entries, with
designations resolved from the officer id, the division named, and the
`detail` jsonb rendered - a rejection showing *"tower wagon double-booked on
Thursday"* and the demonstration reset showing its note. The empty,
unreachable and no-database states were checked separately. Nothing here is
claimed from reading the code.

## Phase 3 — visible parity · ~7 h

| | Feature | Time | Why |
|---|---|---|---|
| 3a | Corridor map | **DONE** | rail-bloc has one. Real coordinates, SVG, no new dependency |
| 3b | Master Gantt by department | **DONE** | Blocks already carry departments |

**As built.** The map is rotated onto the corridor's own axis, with a north
arrow, and each section is shaded by the blocks placed on it - not by
detention pressure. The four sections' mean detention differs by 2 minutes
per slot against a 69-minute spread across the day: in the surface the plan
is priced with, cost is a matter of hour, not place, and the planner's heat
strip already shows that.
Stretching a two-minute difference across the colour range would have drawn a
dramatic map of nothing. The Gantt draws departments against time and ties
the bars of a clubbed block together, so a shared block reads as one decision.

## Phase 4 — the Replanner · DONE

`/replan`. A USFD flaw is found on SEC-02 at Wednesday 06:00 and must be
removed within 24 hours; Thursday is a blackout day.

**What the replan does.** Blocks already executed are frozen exactly as they
ran. The flaw is required, not priced. Then, lexicographically: keep as many
statutory jobs as can be kept; holding that, change the fewest approved jobs;
holding both, be cheapest. Every stage starts from a hint - the approved plan,
then the previous stage's answer.

**Measured on the shipped week.** The flaw is absorbed into Wednesday's
SEC-02 block, already granted, with no new block. 7 of 10 approved future
blocks are unchanged. One approved job changes - proven the fewest possible -
and it is statutory: ENGG-047 cannot be kept, and that is proven too, because
the statutory count is a proven maximum.

**The counterfactual is computed, not claimed.** The builder re-solves with one
more unit of each resource the flaw needs. One more gang: nothing lost and ZERO
approved jobs changed. One more USFD unit: no help. So the answer to a DRM is
specific and checkable: arrange one more gang for Wednesday.

**What the first design got wrong, recorded.** A weighted cost on change, with
no hint, kept 0 of 10 approved blocks, deferred 8 tasks and lost two statutory
jobs - one of which could have stayed in its approved block at no cost. The
search never got near the approved plan. Then, with the hint and disruption
minimised FIRST, it traded a statutory job for fewer changes; statutory now
ranks first. The tests include one that fails on each of these.

**What it is not.** One disruption, re-solved offline in about three minutes
and precomputed so it cannot fail on stage. It is not live monitoring;
continuous replanning stays designed, not built.

**Clear-eyed:** 18 of 28 rivals replan. What none of them do is prove the
disruption minimal, prove the statutory loss forced, or name the resource that
would have avoided it.

## Phase 5 — the pitch · DONE

Lead with the two things that are 0-of-28 and already built: the **displayed
proven floor** and **conformal calibration**. Drop the three dead claims before
a judge who has read rail-bloc drops them for us. `docs/PITCH.md` carries the
running order, now with the replan and the fingerprint.

---

## Not building, and why

| | Reason |
|---|---|
| LLM copilot | An API key, latency and a live failure mode, and it contradicts "every number traceable to code" |
| Recovery Plan A/B/C | Three solves for one demo moment |
| User management, data-source config | Nobody opens them in ten minutes |
| Docker | Cannot be tested on this machine, and an untested Dockerfile would be the fourth stated-but-not-built claim |

---

## Phase 6 — the monthly horizon · DONE 28 Sep

The problem statement asks for weekly **and** monthly plans; at least three
of the 28 rivals had a monthly one and we had none. `/monthly` now allocates a
month of backlog to weeks and checks itself against the weekly solver: week 1
fits **60 of 66** to the minute, and the rest roll forward into a re-plan of
weeks 2-4.

**The first version was three times too optimistic**, and the check is what
caught it: it assumed every crew could work in every block at once and put 103
jobs into week 1, of which the weekly solver could place 66. Held instead to
the packing the weekly solver achieves on a full week (1.2 work-hours per
block-hour, measured), week 1 gets 66 and 60 fit. A second bug was in the
explanation, not the plan: every deferral read "no room" while weeks 3 and 4
stood half empty - most were priced out, and now say so.

## 28 Sep — the cleanup pass

Asked for dead code and stale docs. What mattered more were four claims the
code did not support, each now corrected and each now guarded by a test:

- **The priced detention surface is not from the timetable.** The timetable is
  ingested and sets the protected paths and the night window, but the model
  that prices the plan still uses a hand-set daily curve. The notice on every
  page said otherwise. Corrected, not yet fixed - fixing it moves every
  headline number (LIMITATIONS §1b).
- **The scale ladder was measured on a superseded engine.** Re-run: same
  verdict, but "feasible at 1,000 tasks" means 46 of 1,000 placed, and
  `/scale` now shows that.
- **The pitch quoted numbers the artefact no longer holds**, including a whole
  stage moment built on a block that no longer costs more.
- **`IMPLEMENTATION.md` described a codebase that was never built**, down to a
  passing-test claim for a test file that does not exist. Rewritten.

Also: sliders that re-solved nothing are now a read-out; the per-block
"cheapest window" figure, computed and never drawn, is drawn; `PLAN.md` is
retired; dead code removed, and unused locals now fail the TypeScript build.

## Where it stands

Everything in Phases 0-5 is built, deployed and checked: 171 engine tests,
52 database checks, 11 fingerprint checks. The one open item that changes
numbers is the detention surface above; it is a decision, not a defect in
hiding.
