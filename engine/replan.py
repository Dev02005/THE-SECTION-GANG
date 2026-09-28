"""
The replanner: something happens mid-week, and the approved plan absorbs it.

A block plan is approved for the week and then the week happens. The case this
module handles is the one a division meets most often and can least defer:
ultrasonic testing finds a rail flaw, and the flaw has to come out within hours.
The plan already granted is partly executed, partly still ahead, and the new job
has to be fitted into what is ahead without tearing up what the block meeting
agreed.

THREE RULES, each a constraint or a priced term rather than a hope.

1. THE PAST IS FIXED. Every block that started before the disruption keeps its
   window, its duration and exactly its tasks. No window in the past may be
   newly granted, and no unfinished work may be put into one. A replan that
   quietly rewrites yesterday is not a replan.

2. THE NEW JOB IS STATUTORY. It carries criticality A and a due slot, so the
   same constraints that govern every other statutory job govern it - it is
   priced and placed, not special-cased.

3. STATUTORY FIRST, THEN DISRUPT AS LITTLE AS POSSIBLE, THEN BE CHEAP.
   Solved lexicographically, in that order: keep as many statutory jobs as can
   be kept; holding that, change the FEWEST approved future tasks; holding
   both, find the cheapest plan by the usual objective.

   The order is a policy decision and it was first got wrong. With disruption
   minimised first, the replan was free to trade a statutory job for fewer
   changes - moving two routine jobs to save a statutory one counted as MORE
   disruption, so it was never considered. A statutory job is a safety
   obligation; a moved routine job is paperwork. Statutory ranks first.
   Moving approved work means re-notifying control, re-issuing caution orders
   and re-rostering a gang, so a replan that is cheaper but tears up the week is
   not a better replan.

   This replaced a weighted churn cost, and the reason is measured. With the
   weight set at twice a block's fixed cost, the first replan kept 0 of the 10
   approved future blocks, deferred 8 tasks and lost two statutory jobs - one of
   which could have stayed in its approved block at no cost at all. Nothing was
   wrong with the weight's size; the search never got near the approved plan,
   started from nothing, and stopped at a poor first answer. The approved plan
   is now given to the solver as a HINT, so it starts from what was agreed and
   repairs it, and disruption is minimised first rather than traded off.

WHAT THIS IS NOT. It is not continuous monitoring: nothing here watches a feed.
It is one re-solve of one disruption, precomputed so a demonstration cannot
fail on a live solve - the same rule the main plan already follows. The machinery
is general; the scenario is one.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from ortools.sat.python import cp_model

from engine.core.activities import ACTIVITIES
from engine.core.schema import (
    SLOTS_DAY,
    Criticality,
    Department,
    Line,
    Plan,
    PolicyWeights,
    SolveStats,
    Task,
)
from engine.models.pricing import price_instance
from engine.solver.build import ModelVars, build
from engine.solver.extract import extract
from engine.solver.model import _configure
from engine.solver.objective import add_objective

URGENT_TID = "ENGG-URG-01"  # the USFD flaw's id; other emergencies take their dept's
USFD_FLAW = "ENG.RAIL.USFD_FLAW"
_BY_CODE = {a.code: a for a in ACTIVITIES}


def urgent_tid(dept: Department) -> str:
    """One urgent job per replan; its id names the department that owns it."""
    return f"{dept.value}-URG-01"


@dataclass(frozen=True)
class Disruption:
    """What happened, where, and by when it must be dealt with."""

    at_slot: int
    section: str
    line: Line
    due_within_slots: int
    label: str


def urgent_job(instance: dict[str, Any], d: Disruption, code: str = USFD_FLAW) -> Task:
    """
    The urgent job, built from the shared activity vocabulary and then priced by
    the same models as every other task - so its duration is the duration model's
    P90 for this activity on this section, not a number chosen for the demo.

    Any activity in the vocabulary can be the emergency. It is always statutory
    (it must be dealt with), and it carries its department's physical rules: a
    traction job needs a power block over the section, an S&T job a disconnection.
    """
    act = _BY_CODE[code]
    sec = next(s for s in instance["sections"] if s.sid == d.section)
    p50 = max(1, round(act.p50_minutes / (1440 / SLOTS_DAY)))
    raw = Task(
        tid=urgent_tid(act.dept),
        dept=act.dept,
        section=d.section,
        line=d.line,
        km=round((sec.km_from + sec.km_to) / 2, 1),
        activity=act.label,
        criticality=Criticality.A,
        p50=p50,
        p90=max(2, p50 + 1),
        due_slot=d.at_slot + d.due_within_slots,
        hazard=act.base_hazard,
        consequence=act.consequence_minutes,
        resources=dict(act.resources),
        needs_power_block=act.dept is Department.TRD,
        needs_disconnection=act.dept is Department.SNT,
    )
    priced = price_instance({**instance, "tasks": [raw]})
    return priced["tasks"][0]


def usfd_flaw(instance: dict[str, Any], d: Disruption) -> Task:
    """The original scenario's job: a USFD rail flaw."""
    return urgent_job(instance, d, USFD_FLAW)


def freeze_past(mv: ModelVars, approved: Plan, at_slot: int) -> int:
    """
    Pin every window that starts before `at_slot` to exactly what was approved.

    Returns the number of executed blocks frozen. Raises if an approved
    assignment has no variable to pin - silently leaving it free would let the
    solver rewrite executed work, which is the one thing a replan must never do.
    """
    #  snake_case `add`, unlike build.py and objective.py: it is the API the
    #  OR-Tools stubs declare, so this module stays under full type checking
    #  rather than joining the attr-defined exemption in pyproject.toml.
    m = mv.model
    approved_blocks = {b.wid: b for b in approved.blocks}
    frozen = 0
    for wid, win in mv.by_wid.items():
        if win.start >= at_slot:
            continue
        b = approved_blocks.get(wid)
        if b is None:
            #  Not granted in the approved plan, and it is already in the past.
            m.add(mv.granted[wid] == 0)
        else:
            m.add(mv.granted[wid] == 1)
            m.add(mv.dur[wid] == b.dur)
            frozen += 1
        #  The exact task set of every past window: its approved tasks and no
        #  others. This is what stops unfinished work being put into yesterday.
        members = set(b.tasks) if b is not None else set()
        for tid in mv.by_window[wid]:
            m.add(mv.x[(tid, wid)] == (1 if tid in members else 0))
        for tid in members:
            if (tid, wid) not in mv.x:
                raise ValueError(f"approved {tid} in {wid} has no variable to freeze")

    #  Executed tasks also keep their exact start slot.
    for t in approved.tasks:
        if (
            t.scheduled
            and t.window is not None
            and t.start is not None
            and mv.by_wid[t.window].start < at_slot
        ):
            m.add(mv.ts[t.tid] == t.start)
    return frozen


def churn_count(mv: ModelVars, approved: Plan, at_slot: int) -> Any:
    """
    How many approved FUTURE tasks are not left in their approved block.

    `1 - x[t, w*]` is 1 when the task moved and also when it was deferred, since
    x sums to whether the task is scheduled - so both kinds of change count.
    Executed tasks are frozen by `freeze_past` and are not disruption.
    """
    terms: list[Any] = []
    for t in approved.tasks:
        if not t.scheduled or t.window is None:
            continue
        if mv.by_wid[t.window].start < at_slot:
            continue
        key = (t.tid, t.window)
        #  If the approved pair has no variable the task cannot stay, and is
        #  certainly a change: count it as a constant rather than drop it.
        terms.append(1 - mv.x[key] if key in mv.x else 1)
    return sum(terms)


def _hint(mv: ModelVars, value: Any) -> None:
    """Hint every decision variable from `value(var) -> int`."""
    m = mv.model
    m.clear_hints()
    for wid in mv.granted:
        m.add_hint(mv.granted[wid], value(mv.granted[wid]))
        m.add_hint(mv.dur[wid], value(mv.dur[wid]))
    for var in mv.x.values():
        m.add_hint(var, value(var))
    for tid in mv.sched:
        m.add_hint(mv.sched[tid], value(mv.sched[tid]))
        m.add_hint(mv.ts[tid], value(mv.ts[tid]))


def hint_approved(mv: ModelVars, approved: Plan) -> None:
    """Start the search from the approved plan rather than from nothing."""
    m = mv.model
    blocks = {b.wid: b for b in approved.blocks}
    placed = {(t.tid, t.window) for t in approved.tasks if t.scheduled}
    starts = {
        t.tid: t.start
        for t in approved.tasks
        if t.scheduled and t.start is not None
    }
    m.clear_hints()
    for wid, g in mv.granted.items():
        b = blocks.get(wid)
        m.add_hint(g, 1 if b is not None else 0)
        m.add_hint(mv.dur[wid], b.dur if b is not None else 0)
    for key, v in mv.x.items():
        m.add_hint(v, 1 if key in placed else 0)
    for tid, v in mv.sched.items():
        m.add_hint(v, 1 if tid in starts else 0)
        m.add_hint(mv.ts[tid], starts.get(tid, 0))


@dataclass(frozen=True)
class ReplanResult:
    plan: Plan
    #  Executed blocks pinned exactly as approved.
    frozen: int
    #  Statutory jobs scheduled, the most any plan fitting the new job allows,
    #  and whether that maximum is proven.
    statutory_kept: int | None
    statutory_proven: bool
    #  The fewest approved future tasks that had to move or be deferred to fit
    #  the new job. None when the job could not be fitted at all.
    min_changes: int | None
    #  True when stage 1 reached OPTIMAL, i.e. no plan fits the job with fewer
    #  changes. False means it is the least found, not the least possible.
    min_changes_proven: bool
    stage1_status: str


def _unsolved(w: PolicyWeights, hard: bool, status: str, started: float) -> Plan:
    return Plan(
        blocks=[], tasks=[], weights=w, statutory_hard=hard,
        stats=SolveStats(
            status=status, objective=0,
            wall_time_s=round(time.perf_counter() - started, 3),
            deterministic=True,
        ),
    )


def replan(
    instance: dict[str, Any],
    approved: Plan,
    urgent: Task,
    at_slot: int,
    weights: PolicyWeights | None = None,
    time_limit_s: float = 60.0,
    work_budget: float | None = None,
) -> ReplanResult:
    """
    Re-solve the rest of the week with the past frozen and the urgent job added.

    Stage 0 maximises statutory jobs kept; stage 1, holding that, minimises
    disruption; stage 2, holding both, minimises the usual cost. Each starts from
    a hint - the approved plan, then the previous stage's answer. Same
    statutory mode as the approved plan, so the replan is judged by the rules of
    the plan it replaces. Deterministic.
    """
    w = weights or approved.weights or PolicyWeights()
    hard = approved.statutory_hard
    inst = {**instance, "tasks": [*instance["tasks"], urgent]}
    started = time.perf_counter()
    ok = (cp_model.OPTIMAL, cp_model.FEASIBLE)

    mv = build(inst, hard_statutory=hard)
    frozen = freeze_past(mv, approved, at_slot)
    #  The flaw is dealt with. Required, not priced: if it cannot be done by its
    #  due slot, the answer is "infeasible", said plainly, not a quiet deferral.
    mv.model.add(mv.sched[urgent.tid] == 1)
    cost = add_objective(mv, inst, w, hard_statutory=hard)
    churn = churn_count(mv, approved, at_slot)

    statutory = sum(
        mv.sched[t.tid] for t in inst["tasks"] if t.criticality is Criticality.A
    )

    #  Stage 0 - keep every statutory job that can be kept.
    hint_approved(mv, approved)
    mv.model.maximize(statutory)
    s0 = _configure(time_limit_s, True, False, work_budget)
    st0 = s0.Solve(mv.model)
    if st0 not in ok:
        return ReplanResult(
            plan=_unsolved(w, hard, s0.StatusName(st0), started),
            frozen=frozen, statutory_kept=None, statutory_proven=False,
            min_changes=None, min_changes_proven=False,
            stage1_status=s0.StatusName(st0),
        )
    kept = round(s0.ObjectiveValue())
    mv.model.add(statutory >= kept)

    #  Stage 1 - holding that, the least disruption that fits the job.
    _hint(mv, s0.Value)
    mv.model.minimize(churn)
    s1 = _configure(time_limit_s, True, False, work_budget)
    st1 = s1.Solve(mv.model)
    if st1 not in ok:
        return ReplanResult(
            plan=_unsolved(w, hard, s1.StatusName(st1), started),
            frozen=frozen, statutory_kept=kept,
            statutory_proven=st0 == cp_model.OPTIMAL,
            min_changes=None, min_changes_proven=False,
            stage1_status=s1.StatusName(st1),
        )
    least = round(s1.ObjectiveValue())

    #  Stage 2 - the cheapest plan that disrupts no more than that.
    mv.model.add(churn <= least)
    _hint(mv, s1.Value)
    mv.model.minimize(cost)
    s2 = _configure(time_limit_s, True, False, work_budget)
    st2 = s2.Solve(mv.model)
    if st2 not in ok:
        #  Stage 1's answer satisfies every stage-2 constraint, so this should
        #  not happen. If it does, say so rather than return stage 1 as if it
        #  had been optimised for cost.
        return ReplanResult(
            plan=_unsolved(w, hard, s2.StatusName(st2), started),
            frozen=frozen, statutory_kept=kept,
            statutory_proven=st0 == cp_model.OPTIMAL, min_changes=least,
            min_changes_proven=st1 == cp_model.OPTIMAL,
            stage1_status=s1.StatusName(st1),
        )
    plan = extract(
        solver=s2, status=st2, mv=mv, instance=inst, w=w,
        started=started, deterministic=True, hard_statutory=hard,
    )
    return ReplanResult(
        plan=plan, frozen=frozen, statutory_kept=kept,
        statutory_proven=st0 == cp_model.OPTIMAL, min_changes=least,
        min_changes_proven=st1 == cp_model.OPTIMAL,
        stage1_status=s1.StatusName(st1),
    )


def diff(
    approved: Plan, replanned: Plan, at_slot: int, urgent_id: str = URGENT_TID
) -> dict[str, Any]:
    """
    What the replan changed, in the terms a block meeting would use.

    Counted from the two plans, never from the solver's objective, so every
    number here can be recounted by hand from the lists it comes with.
    """
    a_task = {t.tid: t for t in approved.tasks}
    r_task = {t.tid: t for t in replanned.tasks}
    a_blk = {b.wid: b for b in approved.blocks}
    r_blk = {b.wid: b for b in replanned.blocks}

    def future(wid: str | None, blocks: dict[str, Any]) -> bool:
        return wid is not None and wid in blocks and blocks[wid].start >= at_slot

    moved, deferred, picked_up = [], [], []
    for tid, a in a_task.items():
        r = r_task.get(tid)
        if r is None:
            continue
        if a.scheduled and future(a.window, a_blk):
            if not r.scheduled:
                deferred.append(tid)
            elif r.window != a.window:
                moved.append({"task": tid, "from": a.window, "to": r.window})
        elif not a.scheduled and r.scheduled:
            picked_up.append(tid)

    executed = sorted(w for w, b in a_blk.items() if b.start < at_slot)
    kept = sorted(
        w for w, b in a_blk.items()
        if b.start >= at_slot and w in r_blk
        and sorted(r_blk[w].tasks) == sorted(b.tasks) and r_blk[w].dur == b.dur
    )
    changed = sorted(
        w for w, b in a_blk.items()
        if b.start >= at_slot and w in r_blk and w not in kept
    )
    dropped = sorted(w for w, b in a_blk.items() if b.start >= at_slot and w not in r_blk)
    added = sorted(w for w in r_blk if w not in a_blk)

    urgent = r_task.get(urgent_id)

    def det(p: Plan, after: bool) -> int:
        return sum(b.detention_minutes for b in p.blocks if (b.start >= at_slot) == after)

    def stat(p: Plan) -> tuple[int, int]:
        a = [t for t in p.tasks if t.criticality is Criticality.A]
        return sum(t.scheduled for t in a), len(a)

    return {
        "executed": executed,
        "kept": kept,
        "changed": changed,
        "dropped": dropped,
        "added": added,
        "tasksMoved": moved,
        "tasksDeferred": sorted(deferred),
        "tasksPickedUp": sorted(picked_up),
        "urgent": None if urgent is None else {
            "tid": urgent.tid,
            "scheduled": urgent.scheduled,
            "window": urgent.window,
            "start": urgent.start,
            "end": urgent.end,
        },
        "detentionAhead": {
            "approved": det(approved, True),
            "replanned": det(replanned, True),
        },
        "statutory": {
            "approved": list(stat(approved)),
            "replanned": list(stat(replanned)),
        },
    }
