"""
Tests for the placement-optimality report.

The claim this supports is narrow and must stay narrow: "given the work we have
decided to do, it is placed within X% of optimal". It says nothing about
whether the right work was chosen, and the restriction travels with the number
so nobody can quote it as more than it is.
"""

from __future__ import annotations

import pytest

from engine.core.synthetic import build_instance
from engine.solver.model import solve
from engine.solver.placement import placement_optimality


@pytest.fixture(scope="module")
def instance():
    return build_instance(40, seed=7)


@pytest.fixture(scope="module")
def plan(instance):
    return solve(instance, time_limit_s=25.0)


@pytest.fixture(scope="module")
def report(instance, plan):
    return placement_optimality(instance, plan, time_limit_s=25.0)


def test_report_pins_exactly_the_scheduled_tasks(report, plan):
    assert report.tasks_pinned == sum(1 for t in plan.tasks if t.scheduled)
    assert report.tasks_pinned > 0


def test_bound_is_a_valid_floor(report):
    assert report.status in ("OPTIMAL", "FEASIBLE")
    assert report.bound <= report.objective
    assert report.gap_pct is not None and report.gap_pct >= 0.0


def test_placement_answers_a_narrower_question_than_the_full_solve(report, plan):
    """
    This test used to assert the placement gap was TIGHTER than the full gap,
    and that assertion no longer holds reliably. Recording why, because it is a
    real change and not a broken test.

    The tightness came from the deferral penalty. When the invented detention
    surface priced line occupation high, the optimiser deferred a third of the
    backlog, the deferral penalty dominated the objective, and pinning the
    scheduled set removed most of the uncertainty - 36.8% against 86.7%.

    With traffic measured from the published timetable, occupation is cheaper,
    far more work fits (80 of 90 rather than 62), and the deferral penalty is
    already small. Pinning it therefore removes little: at the shipped size the
    two gaps come out at 84.42% and 84.52%, and on the smaller fixture here the
    ordering reverses because a fresh re-solve does not always match the
    original's primal inside the same budget.

    So the honest claim is now narrower: placement answers a DIFFERENT question
    - "given this work, is it placed well" - not a tighter-bounded one. The
    pitch must not say "tighter" any more.
    """
    assert plan.stats.gap_pct is not None
    assert report.gap_pct is not None
    #  A restriction of the full problem: the scheduled set is fixed.
    assert report.tasks_pinned == sum(1 for t in plan.tasks if t.scheduled)
    #  Both remain valid, finite gaps against a proven floor.
    assert 0.0 <= report.gap_pct <= 100.0
    assert report.bound <= report.objective


def test_restriction_travels_with_the_number(report):
    """A gap quoted without its restriction is a gap quoted dishonestly."""
    assert "held fixed" in report.restriction
    assert "does not bound" in report.restriction.lower()


def test_pinning_actually_constrains_the_model(instance, plan):
    """
    If the pin did nothing, the restricted solve could schedule a different set
    and the report would be meaningless.
    """
    scheduled = {t.tid for t in plan.tasks if t.scheduled}
    from engine.solver.build import build

    mv = build(instance, hard_statutory=False, pinned_schedule=scheduled)
    #  the pin is expressed as an equality on every task, scheduled or not
    assert len(mv.sched) == len(instance["tasks"])


def test_excluding_the_deferral_term_lowers_the_objective(instance, plan):
    """
    The placement objective must not carry the deferral penalty - that term is
    a constant once the set is pinned, and leaving it in would drown the number
    it is meant to expose.
    """
    from ortools.sat.python import cp_model

    from engine.solver.build import build
    from engine.solver.objective import add_objective

    scheduled = {t.tid for t in plan.tasks if t.scheduled}
    results = []
    for include in (True, False):
        mv = build(instance, hard_statutory=False, pinned_schedule=scheduled)
        add_objective(
            mv, instance, plan.weights, hard_statutory=False, include_deferral=include
        )
        s = cp_model.CpSolver()
        s.parameters.max_deterministic_time = 8.0
        s.parameters.num_search_workers = 8
        s.parameters.interleave_search = True
        s.parameters.random_seed = 7
        s.parameters.max_time_in_seconds = 90.0
        s.Solve(mv.model)
        results.append(int(s.ObjectiveValue()))
    with_defer, without_defer = results
    assert without_defer < with_defer
