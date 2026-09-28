"""
Tests for the replanner.

Each one states a property the replan must have whatever the week looks like,
rather than asserting this instance's particular story. The story - a USFD flaw
absorbed into a block already granted, and the one statutory job that provably
has to give way - is measured on the shipped instance and recorded in the
artefact; these hold on any instance.

The first design of the replanner failed several of these in a way no single
number showed: with a weighted cost on change it kept 0 of 10 approved future
blocks and lost two statutory jobs. The tests below are the ones that would
have caught it.
"""

from __future__ import annotations

import pytest

from engine.core.schema import SLOTS_DAY, Criticality, Line
from engine.core.synthetic import build_instance
from engine.replan import (
    URGENT_TID,
    Disruption,
    diff,
    freeze_past,
    replan,
    urgent_job,
    usfd_flaw,
)
from engine.solver.build import build
from engine.solver.model import solve

AT = SLOTS_DAY + 6 * 4  # Tuesday 06:00


@pytest.fixture(scope="module")
def instance():
    return build_instance(40, seed=7)


@pytest.fixture(scope="module")
def approved(instance):
    return solve(instance, time_limit_s=25.0)


def _flaw(instance, due_within: int):
    sec = instance["sections"][0].sid
    return usfd_flaw(instance, Disruption(AT, sec, Line.UP, due_within, "test"))


@pytest.fixture(scope="module")
def urgent(instance):
    return _flaw(instance, 3 * SLOTS_DAY)


@pytest.fixture(scope="module")
def result(instance, approved, urgent):
    return replan(instance, approved, urgent, AT, time_limit_s=25.0)


def test_replan_solves(result):
    assert result.plan.stats.status in ("OPTIMAL", "FEASIBLE")


def test_executed_blocks_are_unchanged(approved, result):
    """Rule 1. A replan that quietly rewrites yesterday is not a replan."""
    after = {b.wid: b for b in result.plan.blocks}
    past = [b for b in approved.blocks if b.start < AT]
    assert past, "fixture must have executed blocks for this test to mean anything"
    for b in past:
        assert b.wid in after, f"executed block {b.wid} vanished"
        assert after[b.wid].dur == b.dur
        assert sorted(after[b.wid].tasks) == sorted(b.tasks)
    assert result.frozen == len(past)


def test_nothing_new_is_granted_in_the_past(approved, result):
    was = {b.wid for b in approved.blocks}
    for b in result.plan.blocks:
        if b.start < AT:
            assert b.wid in was, f"{b.wid} was granted in the past by the replan"


def test_the_urgent_job_is_statutory_and_done_on_time(urgent, result):
    """Rule 2. Priced and placed by the same rules as every other statutory job."""
    assert urgent.criticality is Criticality.A
    u = next(t for t in result.plan.tasks if t.tid == URGENT_TID)
    assert u.scheduled
    assert u.end is not None and u.end <= urgent.due_slot
    assert u.start is not None and u.start >= AT


def test_statutory_maximum_is_proven_and_reported_as_found(result):
    """Rule 3, first stage. The reported figure is the plan's, not a guess."""
    assert result.statutory_proven
    done = sum(
        1 for t in result.plan.tasks
        if t.criticality is Criticality.A and t.scheduled
    )
    assert result.statutory_kept == done


def _approved_future_moved(approved, plan) -> int:
    after = {t.tid: t for t in plan.tasks}
    blocks = {b.wid: b for b in approved.blocks}
    n = 0
    for t in approved.tasks:
        if t.scheduled and t.window in blocks and blocks[t.window].start >= AT:
            a = after[t.tid]
            if not a.scheduled or a.window != t.window:
                n += 1
    return n


def test_reported_disruption_matches_the_plan(approved, result):
    """The stage-1 minimum is the change the returned plan actually makes."""
    assert result.min_changes == _approved_future_moved(approved, result.plan)


def test_approved_work_stays_put_when_nothing_forces_a_move(instance, approved, urgent):
    """
    Rule 3, second stage - the one the first design failed.

    With resources ample enough that the new job cannot crowd anything out,
    NOTHING approved has to move - so nothing may move. A replanner that treats
    the approved week as a blank slate reshuffles it anyway, because a fresh
    search finds a different local answer; this is the property that stops it.
    """
    ample = {**instance, "resources": {k: 20 for k in instance["resources"]}}
    r = replan(ample, approved, urgent, AT, time_limit_s=25.0)
    assert r.min_changes == 0 and r.min_changes_proven
    assert _approved_future_moved(approved, r.plan) == 0


def test_diff_accounts_for_every_approved_future_block(approved, result):
    d = diff(approved, result.plan, AT)
    future = {b.wid for b in approved.blocks if b.start >= AT}
    accounted = set(d["kept"]) | set(d["changed"]) | set(d["dropped"])
    assert accounted == future
    assert not (set(d["kept"]) & set(d["changed"]))


def test_replan_is_deterministic(instance, approved, urgent, result):
    again = replan(instance, approved, urgent, AT, time_limit_s=25.0)
    key = lambda p: sorted((b.wid, b.dur, tuple(sorted(b.tasks))) for b in p.blocks)  # noqa: E731
    assert key(again.plan) == key(result.plan)
    assert again.min_changes == result.min_changes


def test_an_impossible_deadline_is_reported_not_deferred(instance, approved):
    """
    Required, not priced: a flaw that cannot be dealt with in time is an
    'infeasible' said plainly, never a plan that quietly leaves it undone.
    """
    hopeless = _flaw(instance, 2)  # two slots: shorter than the job itself
    r = replan(instance, approved, hopeless, AT, time_limit_s=10.0)
    assert r.plan.stats.status == "INFEASIBLE"
    assert r.statutory_kept is None and r.min_changes is None
    assert r.plan.blocks == []


def test_freeze_refuses_an_assignment_it_cannot_pin(instance, approved):
    """
    If an executed assignment has no variable, freezing must fail loudly -
    leaving it free would let the solver rewrite work already done.
    """
    past = next(b for b in approved.blocks if b.start < AT)
    stranger = next(
        t.tid for t in instance["tasks"] if t.section != past.section
    )
    def forge(b):
        if b.wid != past.wid:
            return b
        return b.model_copy(update={"tasks": [*b.tasks, stranger]})

    forged = approved.model_copy(
        update={"blocks": [forge(b) for b in approved.blocks]}
    )
    with pytest.raises(ValueError, match="no variable to freeze"):
        freeze_past(build(instance, hard_statutory=approved.statutory_hard), forged, AT)


#  ---------------------------------------------------------------------------
#  The shipped plan is solved with SOFT statutory rules - five statutory jobs
#  cannot be placed, so the hard version is infeasible and the solver falls
#  back. The fixtures above happen to solve HARD, and under hard rules C3
#  already forces every statutory job, the new one included. That made the
#  explicit "the flaw must be dealt with" constraint redundant in every test
#  above - it could be deleted and all of them still passed, which was checked.
#  These two run the path production actually takes.
#  ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def approved_soft(instance):
    return solve(instance, time_limit_s=25.0, hard_statutory=False)


def test_soft_fixture_really_is_soft(approved_soft):
    assert not approved_soft.statutory_hard


def test_under_soft_rules_the_flaw_is_still_required(instance, approved_soft):
    """
    Under soft rules a statutory job CAN be deferred at a price. The new flaw
    must not be: an impossible deadline has to come back INFEASIBLE, not as a
    feasible plan with the flaw quietly left undone.
    """
    hopeless = _flaw(instance, 2)
    r = replan(instance, approved_soft, hopeless, AT, time_limit_s=10.0)
    assert r.plan.stats.status == "INFEASIBLE"
    assert r.plan.blocks == []


def test_under_soft_rules_a_possible_flaw_is_done(instance, approved_soft, urgent):
    r = replan(instance, approved_soft, urgent, AT, time_limit_s=25.0)
    u = next(t for t in r.plan.tasks if t.tid == URGENT_TID)
    assert u.scheduled and u.end is not None and u.end <= urgent.due_slot



def test_an_emergency_traction_job_gets_a_power_block(instance, approved_soft):
    """
    Any activity can be the emergency, and it keeps its department's physical
    rules: OHE work takes the section down, so the job must land in a
    whole-section power block - never a single-road one.
    """
    sec = instance["sections"][0].sid
    d = Disruption(AT, sec, Line.UP, 3 * SLOTS_DAY, "OHE fault")
    job = urgent_job(instance, d, "TRD.OHE.CONTACT_WIRE")
    assert job.needs_power_block and job.criticality is Criticality.A
    r = replan(instance, approved_soft, job, AT, time_limit_s=25.0)
    if r.plan.stats.status not in ("OPTIMAL", "FEASIBLE"):
        pytest.skip("no window before the deadline on this instance")
    placed = next(t for t in r.plan.tasks if t.tid == job.tid)
    block = next(b for b in r.plan.blocks if b.wid == placed.window)
    assert block.scope.value == "SECTION", f"OHE job in a {block.scope.value} block"


def test_the_usfd_scenario_is_unchanged_by_the_generalisation(instance):
    """usfd_flaw is now urgent_job with the USFD code - byte for byte the same job."""
    d = Disruption(AT, instance["sections"][0].sid, Line.UP, SLOTS_DAY, "x")
    assert usfd_flaw(instance, d) == urgent_job(instance, d)
    assert usfd_flaw(instance, d).tid == URGENT_TID
