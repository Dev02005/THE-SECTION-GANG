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

## Phase 0 — REWRITTEN 27 Sep · the database is gone

**Do not follow the old version of this step.** It said to add
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to Vercel. The
project those point at, `xabdudjhscrqnwgipxwl.supabase.co`, **no longer
resolves** — NXDOMAIN, checked against 8.8.8.8, not a timeout. Free-tier
projects are removed after a period of inactivity and this one has been idle
since 6 Sep.

Adding those variables would have pointed the live site at a dead host. The
live site currently works *because* it has no database and runs in offline
demonstration mode; the variables would have replaced a working demo with a
sign-in page that rejects every credential.

So, in order:

1. **Decide about the database.** A new Supabase project costs about fifteen
   minutes: run the ten migrations, import the station CSV, re-seed. That
   restores real scoping, the approval chain, the zone view and the audit log.
   Without it the live site is still a complete demonstration, but the RLS
   story becomes something we describe rather than something a judge can press.
2. **Only then** set the Vercel variables — to the *new* project.
3. Push. `Corridor/` already has the GitHub remote, so the drag-and-drop
   upload the old step described is unnecessary.

**The application no longer depends on the answer to survive.** Configured and
reachable used to be treated as the same thing; they are now distinguished, so
an unreachable database degrades to offline mode behind a banner saying the
record could not be read, and only a *transport* failure does that — a refusal
from Postgres is still obeyed. See LIMITATIONS §8b.

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
| 2b | Plan hash / tamper-evidence | 1 h | rail-bloc's best non-solver idea; one sha256 on the plan row |
| 2c | Premium-class detention (Vande Bharat / Rajdhani) | 2 h | We hold the data and the protected paths. Likely unique, unmistakably railway |
| 2d | Dashboard | 2–3 h | Every number already computed |

**2a as built.** `/audit` is a third nav link rather than a Docs entry,
because it is this zone's own record and not documentation. It states its own
scope before the rows — `my_audit` is ZONE-wide, so a Sr.DEN of Waltair sees
Khurda Road's entries too, which "my audit log" would not suggest. Append-only
is a checked claim, not a slogan: `audit_log` has a select policy and an
insert policy and no update or delete policy, and no routine in the schema
edits a row.

**Unverified, and declared.** The populated table has never been rendered
against real rows, because the database disappeared before it could be. Empty,
unreachable and no-database states were all verified in the browser; the rows
themselves were not. That is the one claim here we cannot yet make.

## Phase 3 — visible parity · ~7 h

| | Feature | Time | Why |
|---|---|---|---|
| 3a | Corridor map / digital twin | 3–4 h | rail-bloc has one. Real coordinates, coloured by detention pressure. SVG, no new dependency |
| 3b | Master Gantt by department | 3–4 h | Blocks already carry departments |

## Phase 4 — the Replanner · 1.5–2 days

Monitor → Simulate → Replan → Recover.

**Cheaper for us than for anyone else:** `build(instance, pinned_schedule=…)`
already exists — pinning completed work and re-solving the rest is machinery
shipped for the optimality bound.

Scope: **one** re-optimised plan with its cost delta, not Recovery A/B/C.
Precompute the demo scenario so it cannot fail live.

**Clear-eyed:** 18 of 28 rivals already replan. This removes a weakness; it
does not create an advantage.

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
