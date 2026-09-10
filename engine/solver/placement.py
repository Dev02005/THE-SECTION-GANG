"""
Placement optimality - the gap that answers the question a planner asks.

The full objective is dominated by the out-of-horizon deferral penalty: on the
reference instance roughly 99% of it is "risk we carry by not doing this work
this week". So the headline gap on that objective is really a statement about
how many deferrals are PROVABLY necessary - a hard thing to bound, and not what
anyone in a block meeting is asking.

The question they do ask is: given the work we have decided to do, is it placed
as well as it could be?

That question has a tight answer. Fix the scheduled set to what the solve chose
and the deferral penalty becomes a constant; what remains is pure placement
cost - risk carried in-horizon, train detention, block overhead, and the
clubbing reward. Re-solving that restricted problem gives a bound on the
placement itself.

We report BOTH. The full gap stays visible because hiding it would be the kind
of selective reporting we criticise elsewhere; the placement gap is offered as
the interpretable one, with its restriction stated.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from ortools.sat.python import cp_model

from engine.core.schema import Plan, PolicyWeights
from engine.solver.build import build
from engine.solver.model import _configure
from engine.solver.objective import add_objective


@dataclass(frozen=True)
class PlacementReport:
    """Optimality of the schedule, holding the set of work fixed."""

    status: str
    objective: int
    bound: int
    gap_pct: float | None
    wall_time_s: float
    tasks_pinned: int
    #  stated alongside every use, so the restriction is never implied away
    restriction: str = (
        "Optimality of the placement, with the set of scheduled work held fixed "
        "at what the full solve chose. Does not bound the choice of which work "
        "to defer."
    )


def placement_optimality(
    instance: dict[str, Any],
    plan: Plan,
    weights: PolicyWeights | None = None,
    time_limit_s: float = 60.0,
    work_budget: float | None = None,
) -> PlacementReport:
    """Re-solve with the scheduled set pinned, and report the remaining gap."""
    w = weights or plan.weights
    pinned = {t.tid for t in plan.tasks if t.scheduled}
    started = time.perf_counter()

    mv = build(instance, hard_statutory=False, pinned_schedule=pinned)
    add_objective(mv, instance, w, hard_statutory=False, include_deferral=False)

    solver = _configure(time_limit_s, True, False, work_budget)
    status = solver.Solve(mv.model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return PlacementReport(
            status=solver.StatusName(status),
            objective=0,
            bound=0,
            gap_pct=None,
            wall_time_s=round(time.perf_counter() - started, 3),
            tasks_pinned=len(pinned),
        )

    obj = int(solver.ObjectiveValue())
    bound = int(solver.BestObjectiveBound())
    gap = round(abs(obj - bound) / max(abs(obj), 1) * 100.0, 2) if obj else None

    return PlacementReport(
        status=solver.StatusName(status),
        objective=obj,
        bound=bound,
        gap_pct=gap,
        wall_time_s=round(time.perf_counter() - started, 3),
        tasks_pinned=len(pinned),
    )
