"""
The monthly horizon: which week each job goes in, and how much corridor each
section needs each week.

The weekly model decides minutes - which window, which start, which road. A
month at that resolution is four times the windows and several times the
backlog, and the scale ladder shows where that ends. So the month is planned a
level up, the way a division actually does it: a tactical allocation of work
to weeks, which the weekly solve then schedules to the minute.

What the monthly model decides, per job: week 1, 2, 3 or 4 of the month, or
deferred out of it. Per section and week: how much corridor time is needed.

What it holds to - each one a coarse form of a weekly constraint:

  * a job is only placed in a week it could finish in before its due date
  * a section's corridor time in a week is capped by its real windows: every
    permitted mid-day corridor and the four longest nights (the weekly
    night-working limit), blackout days excluded and protected-path clipping
    included, because the capacity is read from the generated windows
  * at most two blocks per section per workable day, as in the weekly model
  * a block hosts at most as much simultaneous work on a resource as there are
    units of it, and at most PACKING work-hours per block-hour in all - the
    packing the weekly solve actually achieves on the shipped week. Without
    that cap the first version put 147 jobs into week 1, three times what the
    weekly solver can place in that week
  * each resource's hours in a week are capped by one block per corridor per
    day per unit - the tower wagon cannot be in two places
  * a predecessor goes in the same week as its successor, or earlier

Departments still share: a section-week needs the time of its busiest resource
and its packing, not the sum of every department's hours. That is where
clubbing shows at this level.

Priced in the same detention-minute equivalents as the weekly objective, with
the same deferral and statutory penalties, so a job means the same at both
levels.

The backlog is four weekly cohorts. Cohort 0 is exactly the shipped week's
backlog - same generator, same seed, same task ids - and cohorts 1-3 are the
weeks after it, due dates shifted by 7, 14 and 21 days.
"""

from __future__ import annotations

import random
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from ortools.sat.python import cp_model

from engine.core.candidates import feasible_pair, generate_windows
from engine.core.corridor import Corridor, blackout_days
from engine.core.schema import SCALE, SLOTS_DAY, Criticality, PolicyWeights, Task
from engine.core.synthetic import RESOURCES, SECTIONS, detention_surface, generate_tasks
from engine.solver.config import (
    CLEAR_SLOTS,
    DEFER_PENALTY_SLOTS,
    FIXED_BLOCK_COST,
    MAX_BLOCKS_PER_SECTION_DAY,
    MAX_NIGHT_BLOCKS_PER_SECTION_WEEK,
    SETUP_SLOTS,
    STATUTORY_SOFT_PENALTY,
)

WEEKS = 4
WEEK_SLOTS = 7 * SLOTS_DAY
PER_WEEK = 90  # a week of backlog: the shipped week's size
#  Work-hours per block-hour, x10. MEASURED, not chosen: the weekly solve packs
#  2.06 on the light shipped week but only 1.22 on a full one - blocks come out
#  short and jobs on different roads need separate blocks - and a month's weeks
#  are full. Holding the monthly plan to 2.0 put 103 jobs in week 1 of which the
#  weekly solver could place 66; the full-week figure is the honest one.
PACKING_X10 = 12

Key = tuple[str, int]


def month_instance(
    seed: int = 7, weeks: int = WEEKS, per_week: int = PER_WEEK
) -> dict[str, Any]:
    """A month of backlog on the reference corridor. Cohort 0 is the shipped week."""
    tasks: list[Task] = []
    cohort: dict[str, int] = {}
    for k in range(weeks):
        #  Random(seed) for cohort 0 is what build_instance draws from first, so
        #  the month's first week of backlog is the planner's backlog, id for id.
        rng = random.Random(seed if k == 0 else seed * 1000 + k)
        for t in generate_tasks(SECTIONS, per_week, rng):
            tid = t.tid if k == 0 else f"W{k + 1}-{t.tid}"
            due = t.due_slot + k * WEEK_SLOTS
            tasks.append(t.model_copy(update={"tid": tid, "due_slot": due}))
            cohort[tid] = k
    horizon = weeks * WEEK_SLOTS
    return {
        "sections": SECTIONS,
        "tasks": tasks,
        "windows": generate_windows(SECTIONS, 7 * weeks, None),
        "detention": detention_surface(SECTIONS, horizon, random.Random(seed)),
        "resources": dict(RESOURCES),
        "horizon_slots": horizon,
        "seed": seed,
        "synthetic": True,
        "cohort": cohort,
    }


@dataclass
class Capacity:
    """What the windows allow, per section-week and per week."""

    corridor: dict[Key, int]     # section-week corridor slots
    rate: dict[Key, int]         # scaled detention per block slot, one road
    unit_slots: dict[int, int]   # slots one resource unit can work in a week
    workable_days: dict[int, int]


def capacity(instance: dict[str, Any]) -> Capacity:
    horizon = instance["horizon_slots"]
    weeks = horizon // WEEK_SLOTS
    surface = instance["detention"]
    #  per (section, day, night): the first and last slot any window reaches
    span: dict[tuple[str, int, bool], tuple[int, int]] = {}
    for w in instance["windows"]:
        k = (w.section, w.day, w.night)
        lo, hi = span.get(k, (w.start, w.start + w.max_dur))
        span[k] = (min(lo, w.start), max(hi, w.start + w.max_dur))

    corridor: dict[Key, int] = {}
    rate: dict[Key, int] = {}
    for s in instance["sections"]:
        for wk in range(weeks):
            days = range(7 * wk, 7 * wk + 7)
            mids = [span[(s.sid, d, False)] for d in days if (s.sid, d, False) in span]
            nights = [span[(s.sid, d, True)] for d in days if (s.sid, d, True) in span]
            nights.sort(key=lambda r: r[1] - r[0], reverse=True)
            used = mids + nights[:MAX_NIGHT_BLOCKS_PER_SECTION_WEEK]
            corridor[(s.sid, wk)] = sum(hi - lo for lo, hi in used)
            slots = [i for lo, hi in used for i in range(lo, min(hi, horizon))]
            up, dn = surface[(s.sid, "UP")], surface[(s.sid, "DN")]
            per_slot = [(up[i] + dn[i]) / 2 for i in slots]
            mean = sum(per_slot) / len(per_slot) if per_slot else 0.0
            rate[(s.sid, wk)] = round(SCALE * mean)

    unit_slots: dict[int, int] = {}
    for wk in range(weeks):
        total = 0
        for d in range(7 * wk, 7 * wk + 7):
            for night in (False, True):
                #  a unit works one block per corridor, and every block gives a
                #  slot at each end to protection and clearance
                lens = [hi - lo - SETUP_SLOTS - CLEAR_SLOTS
                        for (_, day, n), (lo, hi) in span.items()
                        if day == d and n is night]
                total += max(lens, default=0)
        unit_slots[wk] = total
    off = blackout_days()
    workable = {wk: sum(1 for d in range(7) if d not in off) for wk in range(weeks)}
    return Capacity(corridor, rate, unit_slots, workable)


@dataclass
class MonthPlan:
    status: str
    objective: int | None
    bound: float | None
    week_of: dict[str, int | None]
    block_slots: dict[Key, int] = field(default_factory=dict)
    both_roads: dict[Key, int] = field(default_factory=dict)
    wall_time_s: float = 0.0


def solve_month(
    instance: dict[str, Any],
    weights: PolicyWeights | None = None,
    work_budget: float = 30.0,
    time_limit_s: float = 120.0,
) -> MonthPlan:
    w8 = weights or PolicyWeights()
    tasks: list[Task] = instance["tasks"]
    horizon = instance["horizon_slots"]
    weeks = horizon // WEEK_SLOTS
    res = instance["resources"]
    cap = capacity(instance)
    m = cp_model.CpModel()

    #  A job may go in a week only if some window that week could take it, by
    #  the weekly model's own rule: road and scope, power block, setup + job +
    #  clearance inside the window, finished by its due date.
    wins: dict[Key, list[Any]] = defaultdict(list)
    for w in instance["windows"]:
        wins[(w.section, w.start // WEEK_SLOTS)].append(w)
    a: dict[Key, cp_model.IntVar] = {}
    for t in tasks:
        for wk in range(weeks):
            if any(feasible_pair(t, w, horizon, SETUP_SLOTS, CLEAR_SLOTS)
                   for w in wins[(t.section, wk)]):
                a[(t.tid, wk)] = m.new_bool_var(f"a[{t.tid},{wk}]")

    def weeks_of(tid: str, upto: int = weeks - 1) -> list[cp_model.IntVar]:
        return [a[(tid, v)] for v in range(upto + 1) if (tid, v) in a]

    placed = {t.tid: sum(weeks_of(t.tid)) for t in tasks}
    for t in tasks:
        m.add(placed[t.tid] <= 1)

    known = {t.tid for t in tasks}
    for t in tasks:                                        # predecessor no later
        for pred in t.predecessors:
            if pred in known:
                for wk in range(weeks):
                    if (t.tid, wk) in a:
                        m.add(sum(weeks_of(pred, wk)) >= a[(t.tid, wk)])

    obj: list[Any] = []
    blocks: dict[Key, cp_model.IntVar] = {}
    power: dict[Key, cp_model.IntVar] = {}
    for s in instance["sections"]:
        for wk in range(weeks):
            here = [t for t in tasks if t.section == s.sid and (t.tid, wk) in a]
            c = cap.corridor[(s.sid, wk)]
            blk = m.new_int_var(0, c, f"B[{s.sid},{wk}]")
            pwr = m.new_int_var(0, c, f"P[{s.sid},{wk}]")
            nblk = m.new_int_var(0, MAX_BLOCKS_PER_SECTION_DAY * cap.workable_days[wk],
                                 f"N[{s.sid},{wk}]")
            m.add(pwr <= blk)
            m.add(nblk * Corridor.MAX_BLOCK_SLOTS >= blk)
            work = [t.booked * a[(t.tid, wk)] for t in here]
            if work:                  # measured packing, net of protection/clearance
                overhead = (SETUP_SLOTS + CLEAR_SLOTS) * nblk
                m.add(10 * sum(work) <= PACKING_X10 * (blk - overhead))
            for r, units in res.items():                   # side by side, up to units
                load = [t.booked * t.resources[r] * a[(t.tid, wk)]
                        for t in here if r in t.resources]
                if load:
                    m.add(blk * units >= sum(load))
            trd = [t.booked * a[(t.tid, wk)] for t in here if t.needs_power_block]
            if trd:
                m.add(pwr * res["TRD_CREW"] >= sum(trd))
            for t in here:                                 # no job outlasts its blocks
                m.add(blk >= t.booked * a[(t.tid, wk)])
                if t.needs_power_block:
                    m.add(pwr >= t.booked * a[(t.tid, wk)])
            #  one road for the block; the second road while a power block runs
            obj.append(int(w8.alpha_detention) * cap.rate[(s.sid, wk)] * (blk + pwr))
            obj.append(int(w8.alpha_fixed * FIXED_BLOCK_COST) * nblk)
            blocks[(s.sid, wk)], power[(s.sid, wk)] = blk, pwr

    for r, units in res.items():                           # division-wide, per week
        for wk in range(weeks):
            load = [t.booked * t.resources[r] * a[(t.tid, wk)]
                    for t in tasks if r in t.resources and (t.tid, wk) in a]
            if load:
                m.add(sum(load) <= units * cap.unit_slots[wk])

    for t in tasks:
        rho = int(w8.alpha_risk * t.risk_rate)
        for wk in range(weeks):
            if (t.tid, wk) in a:                           # risk carried to mid-week
                obj.append(rho * (wk * WEEK_SLOTS + WEEK_SLOTS // 2) * a[(t.tid, wk)])
        obj.append(rho * (horizon + DEFER_PENALTY_SLOTS) * (1 - placed[t.tid]))
        if t.criticality is Criticality.A:
            obj.append(STATUTORY_SOFT_PENALTY * (1 - placed[t.tid]))
    m.minimize(sum(obj))

    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 8
    solver.parameters.interleave_search = True
    solver.parameters.random_seed = 7
    solver.parameters.max_deterministic_time = work_budget
    solver.parameters.max_time_in_seconds = time_limit_s
    t0 = time.perf_counter()
    status = solver.solve(m)
    wall = time.perf_counter() - t0
    name = solver.status_name(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return MonthPlan(name, None, None, {t.tid: None for t in tasks}, wall_time_s=wall)
    week_of: dict[str, int | None] = {
        t.tid: next((wk for wk in range(weeks)
                     if (t.tid, wk) in a and solver.value(a[(t.tid, wk)])), None)
        for t in tasks
    }
    return MonthPlan(
        name, round(solver.objective_value), solver.best_objective_bound, week_of,
        {k: int(solver.value(v)) for k, v in blocks.items()},
        {k: int(solver.value(v)) for k, v in power.items()},
        wall,
    )


def resource_load(
    instance: dict[str, Any], plan: MonthPlan
) -> dict[str, dict[int, tuple[int, int]]]:
    """Per resource and week: (slots used, slots available)."""
    cap = capacity(instance)
    used: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for t in instance["tasks"]:
        wk = plan.week_of.get(t.tid)
        if wk is not None:
            for r, q in t.resources.items():
                used[r][wk] += t.booked * q
    weeks = instance["horizon_slots"] // WEEK_SLOTS
    return {
        r: {wk: (used[r][wk], n * cap.unit_slots[wk]) for wk in range(weeks)}
        for r, n in instance["resources"].items()
    }


def span_slice(
    instance: dict[str, Any], tids: set[str], first_week: int, n_weeks: int = 1
) -> dict[str, Any]:
    """The instance for a run of weeks: those jobs, those weeks' windows and surface."""
    lo, hi = first_week * WEEK_SLOTS, (first_week + n_weeks) * WEEK_SLOTS
    tasks = [t.model_copy(update={"due_slot": t.due_slot - lo})
             for t in instance["tasks"] if t.tid in tids]
    windows = [w.model_copy(update={"start": w.start - lo, "day": w.day - 7 * first_week})
               for w in instance["windows"]
               if lo <= w.start and w.start + w.max_dur <= hi]
    return {
        **instance,
        "tasks": tasks,
        "windows": windows,
        "detention": {k: v[lo:hi] for k, v in instance["detention"].items()},
        "horizon_slots": hi - lo,
    }


def week_slice(instance: dict[str, Any], tids: set[str], week: int = 0) -> dict[str, Any]:
    """The weekly instance for one week of the month."""
    return span_slice(instance, tids, week, 1)
