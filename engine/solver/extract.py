"""
Pulling the solution out - including the bound, which is the point.

Telling a division a plan is within N% of optimal is worth more than a
marginally better plan with no bound at all, and it is the argument for CP-SAT
over a metaheuristic.  Every other entry in this field runs a solver capable of
producing a bound and none of them surface it.
"""

from __future__ import annotations

import time
from typing import Any

from engine.core.schema import (
    SCALE,
    Criticality,
    Plan,
    PlannedBlock,
    PlannedTask,
    PolicyWeights,
    Shortfall,
    SolveStats,
    Task,
)
from engine.solver.build import ModelVars
from engine.solver.constraints import label


def extract(
    *,
    solver: Any,
    status: Any,
    mv: ModelVars,
    instance: dict[str, Any],
    w: PolicyWeights,
    started: float,
    deterministic: bool,
    hard_statutory: bool,
) -> Plan:
    """Read the solved model back into a Plan."""
    blocks: list[PlannedBlock] = []
    for win in instance["windows"]:
        if solver.Value(mv.granted[win.wid]) != 1:
            continue
        tids = [
            t for t in mv.by_window[win.wid] if solver.Value(mv.x[(t, win.wid)]) == 1
        ]
        blocks.append(
            PlannedBlock(
                wid=win.wid,
                section=win.section,
                scope=win.scope,
                day=win.day,
                start=win.start,
                dur=solver.Value(mv.dur[win.wid]),
                depts=sorted({mv.by_tid[t].dept for t in tids}, key=lambda d: d.value),
                tasks=tids,
                detention_minutes=solver.Value(mv.det_cost[win.wid]) // SCALE,
            )
        )
    blocks.sort(key=lambda b: (b.start, b.section))

    planned: list[PlannedTask] = []
    shortfall: list[Shortfall] = []
    for t in instance["tasks"]:
        on = solver.Value(mv.sched[t.tid]) == 1
        wid = (
            next(
                (v for v in mv.by_task[t.tid] if solver.Value(mv.x[(t.tid, v)]) == 1),
                None,
            )
            if on
            else None
        )
        planned.append(
            PlannedTask(
                tid=t.tid,
                dept=t.dept,
                section=t.section,
                activity=t.activity,
                criticality=t.criticality,
                window=wid,
                start=solver.Value(mv.ts[t.tid]) if on else None,
                end=solver.Value(mv.te[t.tid]) if on else None,
                scheduled=on,
                risk_rate=t.risk_rate,
                schedule_driven=t.schedule_driven,
            )
        )
        if not on and t.criticality is Criticality.A:
            shortfall.append(
                Shortfall(
                    tid=t.tid,
                    criticality=t.criticality,
                    risk_rate=t.risk_rate,
                    binding_constraint=binding_constraint(t),
                )
            )

    obj = int(solver.ObjectiveValue())
    bound = int(solver.BestObjectiveBound())
    gap = round(abs(obj - bound) / max(abs(obj), 1) * 100.0, 2) if obj else None

    return Plan(
        blocks=blocks,
        tasks=planned,
        shortfall=shortfall,
        weights=w,
        stats=SolveStats(
            status=solver.StatusName(status),
            objective=obj,
            bound=bound,
            gap_pct=gap,
            wall_time_s=round(time.perf_counter() - started, 3),
            conflicts=solver.NumConflicts(),
            branches=solver.NumBranches(),
            deterministic=deterministic,
        ),
        statutory_hard=hard_statutory and not shortfall,
    )


def binding_constraint(task: Task) -> str:
    """
    Best-effort attribution of why a task could not be placed.  Crude, but far
    more useful to a DRM than the word 'infeasible'.

    Named, not numbered.  This string is carried into the shortfall list on the
    printed plan and taken to the zonal machine-allocation meeting; "TOWER_WAGON
    capacity (C8)" reads like a compiler error, "tower wagon" reads like the
    reason.  The paper identifier stays in brackets for anyone following the
    model.
    """
    if task.resources.get("TOWER_WAGON"):
        return f"{label('C8')} — tower wagon"
    if task.resources.get("TAMPER"):
        return f"{label('C8')} — tamper"
    if task.needs_power_block:
        return f"{label('C7')} — no section-scope window free"
    return label("C9")
