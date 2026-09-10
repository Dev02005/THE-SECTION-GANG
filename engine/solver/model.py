"""
Solve orchestration.

Solve once with criticality-A as a hard statutory obligation.  If the backlog
genuinely exceeds the corridor budget the model is infeasible; we then re-solve
with the obligation softened at a very high penalty and return the plan *plus
an explicit shortfall list*.

Running it hard first matters: when a plan comes back feasible we have a proof
that every statutory obligation is met, not a claim that the penalty was large
enough.  An auditor will care which of those two you have.
"""

from __future__ import annotations

import time
from typing import Any

from ortools.sat.python import cp_model

from engine.core.schema import Plan, PolicyWeights, SolveStats
from engine.solver.build import build
from engine.solver.extract import extract
from engine.solver.objective import add_objective

#  Deterministic work units per wall-clock second, measured on this machine.
#  Only used to translate a caller's wall-clock intent into a work budget; the
#  budget itself is what makes the result reproducible.
_WORK_UNITS_PER_SECOND = 0.45


def _configure(
    time_limit_s: float,
    deterministic: bool,
    log: bool,
    work_budget: float | None = None,
) -> Any:
    solver = cp_model.CpSolver()
    solver.parameters.log_search_progress = log

    if deterministic:
        #  Two separate sources of non-determinism have to be closed, and
        #  closing only the first is a trap we fell into:
        #
        #  1. Worker racing. Plain multi-worker search is not reproducible - the
        #     workers race and the same seed gives different plans.
        #     `interleave_search` runs the same portfolio under a deterministic
        #     schedule, which fixes the search ORDER.
        #
        #  2. Where the search STOPS. A wall-clock limit truncates that ordered
        #     search wherever the machine happens to be, so a loaded run
        #     explores less and can return a different incumbent. Measured:
        #     66,277 branches one run, 60,631 the next, same seed.
        #
        #  `max_deterministic_time` is a work budget, not a clock, so the search
        #  stops after the same amount of work every time. Wall time then varies
        #  with machine load - which is the correct trade: we want the PLAN
        #  stable, not the stopwatch.
        solver.parameters.num_search_workers = 8
        solver.parameters.interleave_search = True
        solver.parameters.random_seed = 7
        solver.parameters.max_deterministic_time = (
            work_budget
            if work_budget is not None
            else time_limit_s * _WORK_UNITS_PER_SECOND
        )
        #  A generous wall-clock backstop so a pathological instance cannot run
        #  forever. It should not bind; if it does, the plan may not reproduce.
        solver.parameters.max_time_in_seconds = max(time_limit_s * 4.0, 60.0)
    else:
        #  Free-running portfolio. Better objective, not reproducible. Only for
        #  offline precompute, where the artefact we ship is fixed anyway.
        solver.parameters.num_search_workers = 8
        solver.parameters.max_time_in_seconds = time_limit_s
    return solver


def solve(
    instance: dict[str, Any],
    weights: PolicyWeights | None = None,
    time_limit_s: float = 30.0,
    deterministic: bool = True,
    hard_statutory: bool = True,
    log: bool = False,
    work_budget: float | None = None,
) -> Plan:
    """
    Build, price, solve, extract. Falls back to a soft statutory re-solve.

    In deterministic mode `work_budget` (deterministic work units) governs when
    the search stops; `time_limit_s` only sets a backstop. Pass `work_budget`
    directly when you want a plan that is byte-identical across machines.
    """
    w = weights or PolicyWeights()
    started = time.perf_counter()

    mv = build(instance, hard_statutory=hard_statutory)
    add_objective(mv, instance, w, hard_statutory=hard_statutory)

    solver = _configure(time_limit_s, deterministic, log, work_budget)
    status = solver.Solve(mv.model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        if hard_statutory:
            return solve(
                instance, w, time_limit_s, deterministic, False, log, work_budget
            )
        return Plan(
            blocks=[],
            tasks=[],
            weights=w,
            stats=SolveStats(
                status=solver.StatusName(status),
                objective=0,
                wall_time_s=round(time.perf_counter() - started, 3),
                deterministic=deterministic,
            ),
            statutory_hard=hard_statutory,
        )

    return extract(
        solver=solver,
        status=status,
        mv=mv,
        instance=instance,
        w=w,
        started=started,
        deterministic=deterministic,
        hard_statutory=hard_statutory,
    )
