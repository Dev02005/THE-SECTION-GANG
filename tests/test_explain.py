"""
Tests for the block explanations.

The risk with an explainer is that it becomes a narrative template with numbers
poured in. These tests exist to keep every figure derived from the plan and the
same detention surface the optimiser used, and to keep the comparison honest -
the alternative is given the BEST case available to it, so a saving we report is
a floor rather than a flattering estimate.
"""

from __future__ import annotations

import pytest

from engine.core.synthetic import build_instance
from engine.explain import clubbing_saving, explain_block, explain_plan, placement
from engine.solver.model import solve


@pytest.fixture(scope="module")
def instance():
    return build_instance(45, seed=7)


@pytest.fixture(scope="module")
def plan(instance):
    return solve(instance, time_limit_s=30.0)


def test_every_block_gets_an_explanation(plan, instance):
    ex = explain_plan(plan, instance)
    assert set(ex) == {b.wid for b in plan.blocks}
    assert all(e.headline for e in ex.values())


def test_single_task_blocks_have_no_clubbing_claim(plan, instance):
    """Claiming a clubbing saving on a one-job block would be a lie."""
    for b in plan.blocks:
        if len(b.tasks) == 1:
            assert clubbing_saving(b, instance) is None


def test_clubbing_arithmetic_is_internally_consistent(plan, instance):
    for b in plan.blocks:
        c = clubbing_saving(b, instance)
        if c is None:
            continue
        assert c.separate_blocks == len(b.tasks)
        assert c.actual_detention == b.detention_minutes
        assert c.detention_saved == c.separate_detention - c.actual_detention
        assert c.departments == len(set(b.depts))
        #  overheads scale with the blocks avoided, not with the task count
        assert c.overheads_saved == (c.separate_blocks - 1) * 15


def test_the_alternative_is_given_its_best_case(plan, instance):
    """
    The separate-blocks comparison charges each task the CHEAPEST compatible
    window it could have used. If it were charged the same slot as the actual
    block, the saving would be flattered.
    """
    from engine.core.candidates import compatible
    from engine.explain import _detention_over, _solo_block_slots

    by_tid = {t.tid: t for t in instance["tasks"]}
    clubbed = [b for b in plan.blocks if len(b.tasks) > 1]
    if not clubbed:
        pytest.skip("no clubbed block in this instance")
    b = clubbed[0]
    c = clubbing_saving(b, instance)
    assert c is not None

    recomputed = 0
    for tid in b.tasks:
        t = by_tid[tid]
        need = _solo_block_slots(t)
        best = min(
            (
                _detention_over(
                    instance["detention"], w.section, w.scope, w.start, need,
                    instance["horizon_slots"],
                )
                for w in instance["windows"]
                if compatible(t, w) and need <= w.max_dur
            ),
            default=0,
        )
        recomputed += best
    assert c.separate_detention == recomputed


def test_placement_compares_against_a_real_alternative_window(plan, instance):
    for b in plan.blocks:
        p = placement(b, instance)
        assert p.detention_here == b.detention_minutes
        if p.cheapest_alternative is not None:
            #  the actual block is itself a candidate, so the cheapest option
            #  can never cost more than where we are
            assert p.cheapest_alternative <= p.detention_here
            assert p.penalty_vs_cheapest >= 0


def test_headline_quotes_numbers_that_appear_in_the_data(plan, instance):
    """No figure in the prose that is not in the structured payload."""
    for b in (x for x in plan.blocks if len(x.tasks) > 1):
        e = explain_block(b, instance)
        assert e.clubbing is not None
        assert str(e.clubbing.actual_detention) in e.headline
        assert str(e.clubbing.separate_detention) in e.headline


def test_a_block_that_costs_more_detention_says_so(plan, instance):
    """
    Clubbing does not always save detention - a SECTION block pays both roads.
    Reporting the overhead saving while staying quiet about the detention it
    cost would be exactly the selective arithmetic we criticise elsewhere.
    """
    for b in plan.blocks:
        c = clubbing_saving(b, instance)
        if c is None or c.detention_saved >= 0:
            continue
        headline = explain_block(b, instance).headline
        assert "costs" in headline and "more in detention" in headline
        assert str(-c.detention_saved) in headline
        assert str(c.actual_detention) in headline
        assert str(c.separate_detention) in headline


def test_explanations_are_cheap_enough_to_precompute(plan, instance):
    """They ship in the artefact, so they must not dominate the build."""
    import time

    t0 = time.perf_counter()
    explain_plan(plan, instance)
    assert time.perf_counter() - t0 < 5.0
