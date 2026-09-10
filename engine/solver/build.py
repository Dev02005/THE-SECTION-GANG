"""
Model construction: decision variables and constraints C1-C11.

Kept separate from the objective so the constraint set can be read - and
reviewed against the formulation - without the pricing getting in the way.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ortools.sat.python import cp_model

from engine.core.candidates import feasible_pair, roads_taken
from engine.core.corridor import Corridor
from engine.core.schema import (
    SLOTS_DAY,
    CandidateWindow,
    Criticality,
    Line,
    Task,
)
from engine.solver.config import (
    CLEAR_SLOTS,
    MAX_BLOCKS_PER_SECTION_DAY,
    MAX_NIGHT_BLOCKS_PER_SECTION_WEEK,
    SETUP_SLOTS,
)


@dataclass
class ModelVars:
    """Everything the objective and the extractor need to reach into."""

    model: cp_model.CpModel
    granted: dict[str, Any]
    dur: dict[str, Any]
    ts: dict[str, Any]
    te: dict[str, Any]
    sched: dict[str, Any]
    x: dict[tuple[str, str], Any]
    by_task: dict[str, list[str]]
    by_window: dict[str, list[str]]
    by_tid: dict[str, Task]
    by_wid: dict[str, CandidateWindow]
    det_cost: dict[str, Any] = field(default_factory=dict)


def build(
    instance: dict[str, Any],
    hard_statutory: bool = True,
    pinned_schedule: set[str] | None = None,
) -> ModelVars:
    """
    Variables plus C1-C11 plus the redundant capacity cuts.

    `pinned_schedule` fixes WHICH tasks are done, leaving only WHERE to decide.
    That is what makes the placement-optimality report possible: with the
    deferral set fixed, the huge deferral penalty becomes a constant and the
    remaining gap is a statement about the schedule itself.
    """
    sections = instance["sections"]
    tasks: list[Task] = instance["tasks"]
    windows: list[CandidateWindow] = instance["windows"]
    capacity: dict[str, int] = instance["resources"]
    horizon: int = instance["horizon_slots"]

    m = cp_model.CpModel()
    by_wid = {u.wid: u for u in windows}
    by_tid = {t.tid: t for t in tasks}

    # ---- decision variables --------------------------------------------- #
    granted: dict[str, Any] = {}
    dur: dict[str, Any] = {}
    w_iv: dict[str, Any] = {}
    for win in windows:
        granted[win.wid] = m.NewBoolVar(f"g[{win.wid}]")
        dur[win.wid] = m.NewIntVar(0, win.max_dur, f"d[{win.wid}]")
        w_iv[win.wid] = m.NewOptionalIntervalVar(
            win.start,
            dur[win.wid],
            win.start + dur[win.wid],
            granted[win.wid],
            f"wi[{win.wid}]",
        )
        # C1  a granted block runs at least the minimum; an ungranted one is zero
        m.Add(dur[win.wid] >= Corridor.MIN_BLOCK_SLOTS).OnlyEnforceIf(granted[win.wid])
        m.Add(dur[win.wid] == 0).OnlyEnforceIf(granted[win.wid].Not())

    ts: dict[str, Any] = {}
    te: dict[str, Any] = {}
    sched: dict[str, Any] = {}
    t_iv: dict[str, Any] = {}
    for t in tasks:
        sched[t.tid] = m.NewBoolVar(f"s[{t.tid}]")
        ts[t.tid] = m.NewIntVar(0, horizon, f"ts[{t.tid}]")
        te[t.tid] = m.NewIntVar(0, horizon, f"te[{t.tid}]")
        t_iv[t.tid] = m.NewOptionalIntervalVar(
            ts[t.tid], t.booked, te[t.tid], sched[t.tid], f"ti[{t.tid}]"
        )
        # a deferred task is pinned at 0 so its cost is charged once, via the
        # explicit big penalty, rather than twice
        m.Add(ts[t.tid] == 0).OnlyEnforceIf(sched[t.tid].Not())

    #  Assignment vars only for pairs that are arithmetically possible.
    #
    #  `feasible_pair` drops any (task, window) the task could not fit into or
    #  could not finish by its due date. Both are already constraints, so this
    #  deletes no solution - but it deletes 47% of the variables on the
    #  reference instance and 91% at division scale, which is the difference
    #  between a model that builds and one that does not.
    x: dict[tuple[str, str], Any] = {}
    by_task: dict[str, list[str]] = {t.tid: [] for t in tasks}
    by_window: dict[str, list[str]] = {win.wid: [] for win in windows}
    for t in tasks:
        for win in windows:
            if feasible_pair(t, win, horizon, SETUP_SLOTS, CLEAR_SLOTS):
                x[(t.tid, win.wid)] = m.NewBoolVar(f"x[{t.tid},{win.wid}]")
                by_task[t.tid].append(win.wid)
                by_window[win.wid].append(t.tid)

    # ---- assignment and linking ------------------------------------------ #
    for t in tasks:
        # C2  each task is placed in exactly one window, or deferred
        m.Add(sum(x[(t.tid, wid)] for wid in by_task[t.tid]) == sched[t.tid])
        # C3  statutory work must be done this horizon
        if t.criticality is Criticality.A and hard_statutory:
            m.Add(sched[t.tid] == 1)
        if pinned_schedule is not None:
            m.Add(sched[t.tid] == (1 if t.tid in pinned_schedule else 0))
        # C4  statutory / schedule due date
        if t.due_slot <= horizon:
            m.Add(te[t.tid] <= t.due_slot).OnlyEnforceIf(sched[t.tid])

    for win in windows:
        tids = by_window[win.wid]
        if not tids:
            m.Add(granted[win.wid] == 0)
            continue
        # C5  a block is granted iff at least one task uses it
        for tid in tids:
            m.AddImplication(x[(tid, win.wid)], granted[win.wid])
        m.Add(sum(x[(tid, win.wid)] for tid in tids) >= 1).OnlyEnforceIf(
            granted[win.wid]
        )

    # C6  containment: work starts after protection, ends before clearance
    for (tid, wid), var in x.items():
        win = by_wid[wid]
        m.Add(ts[tid] >= win.start + SETUP_SLOTS).OnlyEnforceIf(var)
        m.Add(te[tid] + CLEAR_SLOTS <= win.start + dur[wid]).OnlyEnforceIf(var)

    #  C6 as an aggregated linear cut.  The indicator form above is correct but
    #  invisible to the linear relaxation, which can therefore set every start
    #  to zero - and since the objective is dominated by rho_t * start_t, that
    #  is exactly what collapses the lower bound.  Exactly one x is set when a
    #  task is scheduled, so this is valid and far tighter.
    for t in tasks:
        wids = by_task[t.tid]
        if wids:
            m.Add(
                ts[t.tid]
                >= sum((by_wid[v].start + SETUP_SLOTS) * x[(t.tid, v)] for v in wids)
            )

    # C7  line occupation.  A SECTION window goes into BOTH roads' sets - one
    #     line of code encoding the power-block coupling.
    for sec in sections:
        for road in (Line.UP, Line.DN):
            ivs = [
                w_iv[win.wid]
                for win in windows
                if win.section == sec.sid and road in roads_taken(win.scope)
            ]
            if ivs:
                m.AddNoOverlap(ivs)

    # C8  resources: machines and crews are shared division-wide
    for res, cap in capacity.items():
        ivs, dem = [], []
        for t in tasks:
            need = t.resources.get(res, 0)
            if need:
                ivs.append(t_iv[t.tid])
                dem.append(need)
        if ivs:
            m.AddCumulative(ivs, dem, cap)

    # C9  blocks per section per day (controller workload, caution-order churn)
    n_days = horizon // SLOTS_DAY
    for sec in sections:
        for day in range(n_days):
            gs = [
                granted[u.wid]
                for u in windows
                if u.section == sec.sid and u.day == day
            ]
            if gs:
                m.Add(sum(gs) <= MAX_BLOCKS_PER_SECTION_DAY)

    # C10 night-working cap per section per week
    for sec in sections:
        gs = [granted[u.wid] for u in windows if u.section == sec.sid and u.night]
        if gs:
            m.Add(sum(gs) <= MAX_NIGHT_BLOCKS_PER_SECTION_WEEK)

    # C11 technological precedence (USFD test before rail renewal)
    for t in tasks:
        for pid in t.predecessors:
            if pid in by_tid:
                m.Add(te[pid] <= ts[t.tid]).OnlyEnforceIf([sched[t.tid], sched[pid]])
                m.AddImplication(sched[t.tid], sched[pid])

    # ---- redundant capacity cuts ----------------------------------------- #
    #  These add no solutions and remove none.  They exist purely so the LINEAR
    #  RELAXATION knows what the propagators already know, which is what makes
    #  the reported optimality gap meaningful instead of vacuous.

    #  Energetic reasoning on each resource: over the whole horizon a resource
    #  of capacity C can supply at most C * (slots on which any block could run)
    #  task-slots.  Work beyond that MUST be deferred, which puts a floor under
    #  the deferral penalty - the largest term in the objective.
    coverable = {s for win in windows for s in range(win.start, win.start + win.max_dur)}
    n_coverable = len(coverable)
    for res, cap in capacity.items():
        demand = [
            (t.resources[res] * t.booked, sched[t.tid])
            for t in tasks
            if t.resources.get(res, 0)
        ]
        if demand:
            m.Add(sum(q * v for q, v in demand) <= cap * n_coverable)

    #  A per-SECTION version of the same energetic cut was tried and removed: it
    #  produced bit-identical results, so no section is individually
    #  over-subscribed on any resource and the constraint never binds.  Recorded
    #  so nobody spends the time discovering that twice.

    #  Per section, granted block time cannot exceed the operating-rule budget:
    #  MAX_BLOCKS_PER_SECTION_DAY blocks a day, each capped by corridor policy.
    for sec in sections:
        ds = [dur[u.wid] for u in windows if u.section == sec.sid]
        if ds:
            m.Add(
                sum(ds)
                <= MAX_BLOCKS_PER_SECTION_DAY * n_days * Corridor.MAX_BLOCK_SLOTS
            )


    return ModelVars(
        model=m,
        granted=granted,
        dur=dur,
        ts=ts,
        te=te,
        sched=sched,
        x=x,
        by_task=by_task,
        by_window=by_window,
        by_tid=by_tid,
        by_wid=by_wid,
    )
