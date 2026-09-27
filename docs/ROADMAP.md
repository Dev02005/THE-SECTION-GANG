# Corridor — plan to regain first place

Written 27 Sep 2026, after re-auditing the field. The rival set grew from seven
repositories to **28**, and three claims this project used to make are no longer
true. This is what we do about it.

*(`PLAN.md` at the root is the original 48-hour build plan and is history. This
file is the forward plan.)*

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

Remaining, in order:

1. Vercel → Settings → Environment Variables → both keys (Production +
   Preview).
2. Push. `Corridor/` already carries the GitHub remote, so no drag-and-drop.

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
| 2c | Premium-class detention (Vande Bharat / Rajdhani) | 2 h | We hold the data and the protected paths. Likely unique, unmistakably railway |
| 2d | Dashboard | 2–3 h | Every number already computed |

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
| 3a | Corridor map / digital twin | 3–4 h | rail-bloc has one. Real coordinates, coloured by detention pressure. SVG, no new dependency |
| 3b | Master Gantt by department | 3–4 h | Blocks already carry departments |

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

## Phase 5 — the pitch · no code

Lead with the two things that are 0-of-28 and already built: the **displayed
proven floor** and **conformal calibration**. Drop the three dead claims before
a judge who has read rail-bloc drops them for us.

---

## Not building, and why

| | Reason |
|---|---|
| LLM copilot | An API key, latency and a live failure mode, and it contradicts "every number traceable to code" |
| Recovery Plan A/B/C | Three solves for one demo moment |
| User management, data-source config | Nobody opens them in ten minutes |
| Docker | Cannot be tested on this machine, and an untested Dockerfile would be the fourth stated-but-not-built claim |

---

## Order of value

Phases 0–2 are the best return: about five hours for a correct live site plus
three features, one of which no rival appears to have.
