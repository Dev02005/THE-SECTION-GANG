"""
Tests for the monthly horizon.

Each states a property the monthly plan must have on any backlog, on a small
unpriced instance so the suite stays fast. The shipped month's own figures -
how much of week 1 the weekly solver actually places - are measured by
engine.build_monthly and checked against the docs in test_docs.
"""

from __future__ import annotations

import pytest

from engine.core.candidates import feasible_pair
from engine.core.schema import Criticality
from engine.core.synthetic import build_instance
from engine.monthly import (
    PACKING_X10,
    WEEK_SLOTS,
    capacity,
    month_instance,
    resource_load,
    solve_month,
    span_slice,
    week_slice,
)
from engine.solver.config import CLEAR_SLOTS, SETUP_SLOTS


@pytest.fixture(scope="module")
def month():
    return month_instance(seed=7, weeks=2, per_week=30)


@pytest.fixture(scope="module")
def plan(month):
    return solve_month(month, work_budget=5.0, time_limit_s=60.0)


def test_month_solves(plan):
    assert plan.status in ("OPTIMAL", "FEASIBLE")


def test_first_week_of_backlog_is_the_shipped_weeks_backlog():
    """Cohort 0 is the planner's week, id for id - not a lookalike."""
    m = month_instance()
    first = [t for t in m["tasks"] if m["cohort"][t.tid] == 0]
    assert [t.model_dump() for t in first] == [
        t.model_dump() for t in build_instance(90, seed=7)["tasks"]
    ]


def test_every_job_sits_in_a_week_it_can_actually_be_done(month, plan):
    """Same rule as the weekly model: some window that week takes it by its due date."""
    for t in month["tasks"]:
        wk = plan.week_of[t.tid]
        if wk is None:
            continue
        assert any(
            feasible_pair(t, w, month["horizon_slots"], SETUP_SLOTS, CLEAR_SLOTS)
            for w in month["windows"]
            if w.section == t.section and w.start // WEEK_SLOTS == wk
        ), f"{t.tid} placed in week {wk + 1}, where no window can take it"


def test_section_corridor_time_stays_within_its_windows(month, plan):
    cap = capacity(month)
    for key, used in plan.block_slots.items():
        assert used <= cap.corridor[key], f"{key}: {used} of {cap.corridor[key]} slots"


def test_work_is_held_to_the_measured_packing(month, plan):
    """No section-week carries more work than PACKING x its block time."""
    for s in month["sections"]:
        for wk in range(2):
            work = sum(t.booked for t in month["tasks"]
                       if t.section == s.sid and plan.week_of[t.tid] == wk)
            assert 10 * work <= PACKING_X10 * plan.block_slots[(s.sid, wk)]


def test_block_time_covers_the_busiest_resource(month, plan):
    """Side by side in one block, but never more at once than there are units."""
    for s in month["sections"]:
        for wk in range(2):
            for r, units in month["resources"].items():
                load = sum(t.booked * t.resources[r] for t in month["tasks"]
                           if r in t.resources and t.section == s.sid
                           and plan.week_of[t.tid] == wk)
                assert load <= units * plan.block_slots[(s.sid, wk)]


def test_no_resource_is_booked_beyond_its_week(month, plan):
    """The tower wagon cannot be in two places: weekly hours within one-per-corridor."""
    for r, weeks in resource_load(month, plan).items():
        for wk, (used, cap) in weeks.items():
            assert used <= cap, f"{r} week {wk + 1}: {used} of {cap} slots"


def test_a_job_whose_predecessor_cannot_go_cannot_go(month):
    """
    A statutory job is worth placing at almost any cost - unless its
    predecessor never can be, in which case it must not be placed either.
    Without the precedence constraint this job is placed.
    """
    tasks = list(month["tasks"])
    succ = next(t for t in tasks if t.criticality is Criticality.A)
    pred = next(t for t in tasks if t.section == succ.section and t.tid != succ.tid)
    tasks = [
        t.model_copy(update={"due_slot": 1}) if t.tid == pred.tid
        else t.model_copy(update={"predecessors": [pred.tid]}) if t.tid == succ.tid
        else t
        for t in tasks
    ]
    p = solve_month({**month, "tasks": tasks}, work_budget=5.0, time_limit_s=60.0)
    assert p.week_of[pred.tid] is None
    assert p.week_of[succ.tid] is None


def test_the_month_is_deterministic(month, plan):
    again = solve_month(month, work_budget=5.0, time_limit_s=60.0)
    assert again.week_of == plan.week_of
    assert again.block_slots == plan.block_slots


def test_week_slice_is_that_week_and_nothing_else(month, plan):
    tids = {tid for tid, wk in plan.week_of.items() if wk == 1}
    sl = week_slice(month, tids, 1)
    assert {t.tid for t in sl["tasks"]} == tids
    assert sl["horizon_slots"] == WEEK_SLOTS
    assert all(w.start >= 0 and w.start + w.max_dur <= WEEK_SLOTS for w in sl["windows"])
    assert all(len(v) == WEEK_SLOTS for v in sl["detention"].values())
    #  due dates move with the week, so "due in 2 days" still means 2 days
    orig = {t.tid: t.due_slot for t in month["tasks"]}
    assert all(t.due_slot == orig[t.tid] - WEEK_SLOTS for t in sl["tasks"])


def test_span_slice_keeps_a_run_of_weeks(month):
    tids = {t.tid for t in month["tasks"]}
    sl = span_slice(month, tids, 0, 2)
    assert sl["horizon_slots"] == 2 * WEEK_SLOTS
    assert len(sl["windows"]) == len(month["windows"])


#  The two limits below only bite when a single machine is the bottleneck, and
#  the small mixed backlog above never makes it one - both constraints were
#  deleted and every test still passed. So: a week of nothing but tower-wagon
#  work, all of it statutory, so the solver wants every job placed.

@pytest.fixture(scope="module")
def wagon():
    m = month_instance(seed=7, weeks=1, per_week=150)
    jobs = [t.model_copy(update={"criticality": Criticality.A})
            for t in m["tasks"] if "TOWER_WAGON" in t.resources]
    return {**m, "tasks": jobs}


@pytest.fixture(scope="module")
def wagon_plan(wagon):
    return solve_month(wagon, work_budget=5.0, time_limit_s=60.0)


def test_one_tower_wagon_is_not_packed_like_a_crew(wagon, wagon_plan):
    """A single machine works one job at a time: its hours never exceed the block's."""
    for s in wagon["sections"]:
        load = sum(t.booked for t in wagon["tasks"]
                   if t.section == s.sid and wagon_plan.week_of[t.tid] == 0)
        assert load <= wagon_plan.block_slots[(s.sid, 0)], s.sid


def test_the_tower_wagon_cannot_be_in_two_places(wagon, wagon_plan):
    """Across all sections, a week's wagon hours stay within one block per corridor."""
    used, cap = resource_load(wagon, wagon_plan)["TOWER_WAGON"][0]
    assert used <= cap, f"{used} of {cap} slots"
    assert any(v is None for v in wagon_plan.week_of.values()), (
        "the fixture must overload the wagon, or this test proves nothing"
    )
