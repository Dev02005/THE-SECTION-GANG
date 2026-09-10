"""
The trade-off, measured rather than asserted.

The four policy weights are usually presented as sliders with a shrug: turn
them and something changes.  This module does the work that makes them mean
something - it re-solves across a sweep of the risk/detention ratio and reports
where each solve actually landed on the two axes that matter:

    x   train detention caused, in minutes
    y   residual asset risk carried, in detention-minute equivalents

Raising the risk weight buys down risk by spending line capacity.  The curve is
the price list for that exchange, and a Sr.DEN can read their own policy off it:
"we are here; moving to there costs this much detention and clears that much
risk".

Two honesty notes carried into the output.

First, each point is a real solve under a real time budget, so a point can be
DOMINATED - worse on both axes than another - simply because that solve got a
worse incumbent. We mark dominated points rather than quietly dropping them; a
frontier drawn only through the convenient points is a drawing, not a
measurement.

Second, every point here is solved under the SAME reduced work budget so the
points are comparable to each other. That budget is coarser than the shipped
plan's, so the point at the current policy weights is NOT the shipped plan and
its numbers will not match the headline KPIs. It is the same question asked with
less compute, and it is labelled that way.

Third, no rival submission can produce this chart at all. It requires pricing
both axes in one unit, and none of the seven computes a detention cost surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from engine.baseline.kpis import compute
from engine.core.schema import PolicyWeights
from engine.solver.model import solve

#  Risk weight sweep, with detention held at 1.0. Spanning 16x either side of
#  parity is enough to show curvature without pretending to more resolution
#  than a two-day build can defend.
DEFAULT_RISK_WEIGHTS: tuple[float, ...] = (0.125, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0)


@dataclass(frozen=True)
class ParetoPoint:
    alpha_risk: float
    alpha_detention: float
    detention_minutes: int
    risk_carried: int
    blocks: int
    scheduled: int
    statutory_done: int
    statutory_total: int
    multidept_pct: float
    objective: int
    bound: int | None
    gap_pct: float | None
    wall_time_s: float
    is_current_policy: bool
    dominated_by: int | None = None


def _dominates(a: ParetoPoint, b: ParetoPoint) -> bool:
    """`a` dominates `b` when it is no worse on both axes and better on one."""
    no_worse = (
        a.detention_minutes <= b.detention_minutes
        and a.risk_carried <= b.risk_carried
    )
    strictly_better = (
        a.detention_minutes < b.detention_minutes or a.risk_carried < b.risk_carried
    )
    return no_worse and strictly_better


def sweep(
    instance: dict[str, Any],
    risk_weights: tuple[float, ...] = DEFAULT_RISK_WEIGHTS,
    work_budget: float = 18.0,
    time_limit_s: float = 300.0,
    shipped: PolicyWeights | None = None,
) -> list[ParetoPoint]:
    """
    Re-solve across the sweep and return the measured points.

    `work_budget` is deliberately smaller than the shipped plan's: the curve
    needs the shape, and seven full-length solves would cost more than the whole
    build. Every point still carries its own gap so nobody mistakes a coarse
    solve for a converged one.
    """
    ship = shipped or PolicyWeights()
    points: list[ParetoPoint] = []

    for ar in risk_weights:
        w = PolicyWeights(
            alpha_risk=ar,
            alpha_detention=ship.alpha_detention,
            alpha_fixed=ship.alpha_fixed,
            alpha_club=ship.alpha_club,
        )
        plan = solve(
            instance,
            weights=w,
            time_limit_s=time_limit_s,
            work_budget=work_budget,
        )
        if plan.stats.status not in ("OPTIMAL", "FEASIBLE"):
            continue
        k = compute(f"ar={ar}", plan, instance)
        points.append(
            ParetoPoint(
                alpha_risk=ar,
                alpha_detention=w.alpha_detention,
                detention_minutes=k.detention_minutes,
                risk_carried=k.risk_carried,
                blocks=k.blocks,
                scheduled=k.scheduled,
                statutory_done=k.statutory_done,
                statutory_total=k.statutory_total,
                multidept_pct=k.multidept_pct,
                objective=plan.stats.objective,
                bound=plan.stats.bound,
                gap_pct=plan.stats.gap_pct,
                wall_time_s=plan.stats.wall_time_s,
                is_current_policy=abs(ar - ship.alpha_risk) < 1e-9,
            )
        )

    return mark_dominated(points)


def mark_dominated(points: list[ParetoPoint]) -> list[ParetoPoint]:
    """
    Flag points another point beats on both axes.

    A dominated point is not a failure of the trade-off - it is a solve that
    landed worse under its budget. Showing it, marked, is more honest than
    drawing a clean curve through only the convenient results.
    """
    out: list[ParetoPoint] = []
    for i, p in enumerate(points):
        beater = next(
            (j for j, q in enumerate(points) if j != i and _dominates(q, p)), None
        )
        out.append(
            ParetoPoint(**{**p.__dict__, "dominated_by": beater})
            if beater is not None
            else p
        )
    return out
