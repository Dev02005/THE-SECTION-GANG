"""
A simulation of how block planning is done today.

This is the most important honesty surface in the whole system.  A plan with no
baseline is a screenshot; a plan with a baseline is a result - but only if the
baseline is a fair opponent.  Four rival submissions beat a strawman and report
the margin as an achievement.

What the baseline DOES do, faithfully:
  * each department works its own arrears register, most-overdue-first, which is
    genuinely how registers are worked
  * departments arrive at the divisional block meeting in a fixed order
  * a department asks for a DEDICATED block per job, because the other two
    registers are invisible to it - it cannot propose clubbing even when it
    would obviously help
  * it takes the EARLIEST corridor slot it can get, not the cheapest, because
    nothing in the current process prices the difference

What the baseline does NOT do, deliberately:
  * it is not given worse duration estimates.  It books the same P90 the
    optimiser books, so the comparison is about PLACEMENT AND PACKING, not
    about who guessed the duration better.  Handicapping it there would be
    exactly the trick we criticise in the field.
  * it is not allowed to produce an unexecutable plan.  It respects the same
    line occupation, resource capacity, per-day and night-working limits.  A
    baseline that cheats on physics would make our margin meaningless.

The honest summary: this is current practice done COMPETENTLY.  The gap it
leaves is structural - no department can see the other two - not a gap in
diligence.
"""

from __future__ import annotations

from typing import Any

from engine.core.candidates import compatible, roads_taken
from engine.core.corridor import Corridor
from engine.core.schema import (
    CandidateWindow,
    Criticality,
    Department,
    Line,
    Plan,
    PlannedBlock,
    PlannedTask,
    PolicyWeights,
    Shortfall,
    SolveStats,
    Task,
)
from engine.solver.config import (
    CLEAR_SLOTS,
    MAX_BLOCKS_PER_SECTION_DAY,
    MAX_NIGHT_BLOCKS_PER_SECTION_WEEK,
    SETUP_SLOTS,
)
from engine.solver.extract import binding_constraint

#  Departments arrive at the divisional block meeting in a settled order.
MEETING_ORDER = (Department.ENGG, Department.SNT, Department.TRD)


def plan_current_practice(instance: dict[str, Any]) -> Plan:
    """Greedy, siloed, earliest-slot-first. Returns an executable plan."""
    tasks: list[Task] = instance["tasks"]
    windows: list[CandidateWindow] = instance["windows"]
    capacity: dict[str, int] = instance["resources"]
    surface = instance["detention"]
    sections = instance["sections"]
    horizon: int = instance["horizon_slots"]

    #  occupancy ledgers - the physics the baseline must also respect
    roads = (Line.UP, Line.DN)
    road_busy: dict[tuple[str, str], list[bool]] = {
        (s.sid, ln.value): [False] * horizon for s in sections for ln in roads
    }
    res_used: dict[str, list[int]] = {r: [0] * horizon for r in capacity}
    per_day: dict[tuple[str, int], int] = {}
    night_count: dict[str, int] = {s.sid: 0 for s in sections}

    windows_by_start = sorted(windows, key=lambda w: (w.start, w.wid))

    #  each department works its own register, most-overdue-first
    order = sorted(
        tasks,
        key=lambda t: (MEETING_ORDER.index(t.dept), t.due_slot, -t.risk_rate, t.tid),
    )

    blocks: list[PlannedBlock] = []
    planned: list[PlannedTask] = []

    for t in order:
        need = max(SETUP_SLOTS + t.booked + CLEAR_SLOTS, Corridor.MIN_BLOCK_SLOTS)
        placed = False

        for w in windows_by_start:
            if not compatible(t, w) or need > w.max_dur:
                continue
            if per_day.get((w.section, w.day), 0) >= MAX_BLOCKS_PER_SECTION_DAY:
                continue
            if w.night and night_count[w.section] >= MAX_NIGHT_BLOCKS_PER_SECTION_WEEK:
                continue

            span = range(w.start, w.start + need)
            if span.stop > horizon:
                continue
            taken = roads_taken(w.scope)
            if any(road_busy[(w.section, ln.value)][s] for ln in taken for s in span):
                continue

            work = range(w.start + SETUP_SLOTS, w.start + SETUP_SLOTS + t.booked)
            if any(
                res_used[r][s] + q > capacity[r]
                for r, q in t.resources.items()
                for s in work
            ):
                continue
            if t.due_slot <= horizon and work.stop > t.due_slot:
                continue

            #  commit
            for ln in taken:
                for s in span:
                    road_busy[(w.section, ln.value)][s] = True
            for r, q in t.resources.items():
                for s in work:
                    res_used[r][s] += q
            per_day[(w.section, w.day)] = per_day.get((w.section, w.day), 0) + 1
            if w.night:
                night_count[w.section] += 1

            detention = sum(
                surface[(w.section, ln.value)][s] for ln in taken for s in span
            )
            blocks.append(
                PlannedBlock(
                    wid=f"{w.wid}-B",
                    section=w.section,
                    scope=w.scope,
                    day=w.day,
                    start=w.start,
                    dur=need,
                    depts=[t.dept],  # one department per block: the whole point
                    tasks=[t.tid],
                    detention_minutes=detention,
                )
            )
            planned.append(
                PlannedTask(
                    tid=t.tid,
                    dept=t.dept,
                    section=t.section,
                    activity=t.activity,
                    criticality=t.criticality,
                    window=f"{w.wid}-B",
                    start=work.start,
                    end=work.stop,
                    scheduled=True,
                    risk_rate=t.risk_rate,
                    schedule_driven=t.schedule_driven,
                )
            )
            placed = True
            break

        if not placed:
            planned.append(
                PlannedTask(
                    tid=t.tid,
                    dept=t.dept,
                    section=t.section,
                    activity=t.activity,
                    criticality=t.criticality,
                    window=None,
                    start=None,
                    end=None,
                    scheduled=False,
                    risk_rate=t.risk_rate,
                    schedule_driven=t.schedule_driven,
                )
            )

    blocks.sort(key=lambda b: (b.start, b.section))

    #  The baseline reports its shortfall too.  Showing the optimised plan's
    #  unmet statutory work while hiding the baseline's would flatter us: the
    #  baseline misses far more, and the comparison should say so.
    by_tid = {t.tid: t for t in tasks}
    unmet = [p for p in planned if not p.scheduled and p.criticality is Criticality.A]
    shortfall = [
        Shortfall(
            tid=p.tid,
            criticality=p.criticality,
            risk_rate=p.risk_rate,
            binding_constraint=binding_constraint(by_tid[p.tid]),
        )
        for p in unmet
    ]

    return Plan(
        blocks=blocks,
        tasks=planned,
        shortfall=shortfall,
        weights=PolicyWeights(),
        stats=SolveStats(
            status="BASELINE",
            objective=0,
            bound=None,
            gap_pct=None,
            wall_time_s=0.0,
            deterministic=True,
        ),
        statutory_hard=not unmet,
    )
