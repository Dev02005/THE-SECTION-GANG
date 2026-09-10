"""
Tests for the scale study.

The value of a scale claim is entirely in whether the reductions behind it are
exact. If `feasible_pair` ever removes an assignment the solver would have used,
the benchmark stops measuring our problem and starts measuring a smaller one -
which is precisely the criticism we make of the fastest rival.
"""

from __future__ import annotations

from itertools import pairwise

import pytest

from engine.core.candidates import compatible, feasible_pair
from engine.core.corridor import division
from engine.core.synthetic import build_instance
from engine.solver.config import CLEAR_SLOTS, SETUP_SLOTS


@pytest.fixture(scope="module")
def instance():
    return build_instance(60, seed=7)


def test_filter_never_rejects_an_assignment_the_solver_uses(instance):
    """
    The decisive property. Build WITHOUT the filter, solve, then check every
    assignment the solver actually chose survives it. A single rejection would
    mean the filter deletes real solutions.
    """
    from ortools.sat.python import cp_model

    from engine.core.schema import PolicyWeights
    from engine.solver import build as build_mod
    from engine.solver import objective as obj_mod
    from engine.solver.model import _configure

    original = build_mod.feasible_pair
    build_mod.feasible_pair = lambda t, w, h, s, c: compatible(t, w)
    try:
        mv = build_mod.build(instance)
        obj_mod.add_objective(mv, instance, PolicyWeights())
    finally:
        build_mod.feasible_pair = original

    solver = _configure(200.0, True, False, 12.0)
    status = solver.Solve(mv.model)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)

    by_tid = {t.tid: t for t in instance["tasks"]}
    by_wid = {w.wid: w for w in instance["windows"]}
    horizon = instance["horizon_slots"]

    used = [(t, w) for (t, w), v in mv.x.items() if solver.Value(v) == 1]
    assert used, "the unfiltered solve placed nothing, so this proves nothing"
    rejected = [
        (t, w)
        for t, w in used
        if not feasible_pair(by_tid[t], by_wid[w], horizon, SETUP_SLOTS, CLEAR_SLOTS)
    ]
    assert not rejected, f"filter would delete real assignments: {rejected[:3]}"


def test_filter_only_ever_narrows_compatibility(instance):
    """It may remove pairs; it must never add one compatibility rejected."""
    horizon = instance["horizon_slots"]
    for t in instance["tasks"][:25]:
        for w in instance["windows"][:120]:
            if feasible_pair(t, w, horizon, SETUP_SLOTS, CLEAR_SLOTS):
                assert compatible(t, w)


def test_filter_rejects_work_that_cannot_finish_by_its_due_date(instance):
    horizon = instance["horizon_slots"]
    task = instance["tasks"][0]
    impossible = task.model_copy(update={"due_slot": 1})
    assert not any(
        feasible_pair(impossible, w, horizon, SETUP_SLOTS, CLEAR_SLOTS)
        for w in instance["windows"]
    )


def test_filter_rejects_work_too_long_for_any_window(instance):
    horizon = instance["horizon_slots"]
    task = instance["tasks"][0]
    huge = task.model_copy(update={"p50": 400, "p90": 500})
    assert not any(
        feasible_pair(huge, w, horizon, SETUP_SLOTS, CLEAR_SLOTS)
        for w in instance["windows"]
    )


def test_filter_measurably_reduces_the_model(instance):
    horizon = instance["horizon_slots"]
    raw = sum(
        1 for t in instance["tasks"] for w in instance["windows"] if compatible(t, w)
    )
    kept = sum(
        1
        for t in instance["tasks"]
        for w in instance["windows"]
        if feasible_pair(t, w, horizon, SETUP_SLOTS, CLEAR_SLOTS)
    )
    assert kept < raw, "the filter should remove something"
    assert kept > 0, "the filter must not remove everything"


# --------------------------------------------------------------------------- #
#  scaling the division, not just the backlog
# --------------------------------------------------------------------------- #


def test_division_scales_and_stays_contiguous():
    """
    Growing the backlog against a fixed corridor is not a scale test - it just
    builds an over-subscribed instance. Sections must grow too, and stay a
    contiguous chain so the adjacency the detention model uses holds.
    """
    secs, adj = division(12)
    assert len(secs) == 12
    assert len(adj) == 12
    #  ends have one neighbour, the middle has two
    assert len(adj[secs[0].sid]) == 1
    assert len(adj[secs[-1].sid]) == 1
    assert all(len(adj[s.sid]) == 2 for s in secs[1:-1])
    #  chainage is continuous
    for a, b in pairwise(secs):
        assert a.km_to == pytest.approx(b.km_from)


def test_division_keeps_the_named_reference_sections():
    secs, _ = division(2)
    assert [s.sid for s in secs] == ["SEC-01", "SEC-02"]
    assert "Duvvada" in secs[0].name


def test_instance_accepts_a_section_count():
    inst = build_instance(50, seed=7, horizon_days=14, start_step_min=120, n_sections=10)
    assert len(inst["sections"]) == 10
    assert {t.section for t in inst["tasks"]} <= {s.sid for s in inst["sections"]}
    assert all(
        (s.sid, road) in inst["detention"]
        for s in inst["sections"]
        for road in ("UP", "DN")
    )
