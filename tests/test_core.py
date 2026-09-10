"""
Tests for the layer beneath the solver: pricing, candidate generation and the
policy filters.

These matter because `test_constraints.py` only proves the optimiser respects
what it is given.  If a protected path is never filtered out, or the risk price
is computed wrongly, the solver will faithfully produce a plan that is wrong in
a way no constraint test can see.
"""

from __future__ import annotations

import math
from itertools import pairwise

import pytest

from engine.core.candidates import (
    compatible,
    detention_table,
    generate_windows,
    roads_taken,
)
from engine.core.corridor import SECTIONS, Corridor, blackout_days, protected_paths
from engine.core.schema import (
    HORIZON_DAYS,
    HORIZON_SLOTS,
    SCALE,
    SLOTS_DAY,
    Criticality,
    Department,
    Line,
    Scope,
    Task,
)
from engine.core.synthetic import build_instance, detention_surface, generate_tasks

# --------------------------------------------------------------------------- #
#  pricing - the core of the whole thesis
# --------------------------------------------------------------------------- #


def _task(**kw) -> Task:
    base = dict(
        tid="T",
        dept=Department.ENGG,
        section="SEC-01",
        line=Line.UP,
        km=1.0,
        activity="a",
        criticality=Criticality.B,
        p50=4,
        p90=6,
        due_slot=HORIZON_SLOTS,
        hazard=0.05,
        consequence=500,
    )
    base.update(kw)
    return Task(**base)  # type: ignore[arg-type]


def test_risk_rate_matches_the_published_formula():
    """rho = ceil(C * lambda / slots_per_day * SCALE). This is the price."""
    t = _task(hazard=0.05, consequence=900)
    expected = max(1, round(0.05 * 900 / SLOTS_DAY * SCALE))
    assert t.risk_rate == expected


def test_risk_rate_is_never_zero():
    """A task priced at zero would be deferred forever. Floor it at 1."""
    assert _task(hazard=1e-9, consequence=1).risk_rate >= 1


def test_risk_rate_orders_a_degraded_rail_above_a_signal_lamp():
    """
    The ratio is the point: it is derived, not hand-set, and it is directly
    comparable to detention cost.
    """
    rail = _task(hazard=0.055 * 3, consequence=900)
    lamp = _task(hazard=0.014, consequence=200)
    assert rail.risk_rate > 10 * lamp.risk_rate


def test_booked_duration_is_p90_not_p50():
    """We book the calibrated P90. Booking P50 means half the blocks overrun."""
    assert _task(p50=4, p90=7).booked == 7


# --------------------------------------------------------------------------- #
#  policy filters - claimed in the code as structurally enforced
# --------------------------------------------------------------------------- #


def test_no_generated_window_overlaps_a_protected_path():
    """
    The code claims a block can never be drawn across a Vande Bharat or
    Rajdhani path because those windows are never created.  That is a safety
    claim about the whole system, so it needs a test rather than a comment.
    """
    prot = protected_paths(HORIZON_DAYS)
    for w in generate_windows(SECTIONS, HORIZON_DAYS):
        for p_start, p_end in prot:
            assert not (w.start < p_end and p_start < w.start + w.max_dur), (
                f"{w.wid} overlaps protected path {p_start}-{p_end}"
            )


def test_no_window_is_generated_on_a_blackout_day():
    blackout = blackout_days()
    days = {w.day for w in generate_windows(SECTIONS, HORIZON_DAYS)}
    assert blackout, "the fixture should declare at least one blackout day"
    assert not (days & blackout), f"windows generated on blackout days {days & blackout}"


def test_every_window_respects_the_corridor_duration_caps():
    for w in generate_windows(SECTIONS, HORIZON_DAYS):
        assert Corridor.MIN_BLOCK_SLOTS <= w.max_dur <= Corridor.MAX_BLOCK_SLOTS


def test_windows_are_generated_for_all_three_scopes_per_slot():
    """UP, DN and SECTION must each be offered, or clubbing cannot be chosen."""
    wins = generate_windows(SECTIONS, HORIZON_DAYS)
    by_scope = {s: sum(1 for w in wins if w.scope is s) for s in Scope}
    assert by_scope[Scope.UP] == by_scope[Scope.DN] == by_scope[Scope.SECTION]
    assert by_scope[Scope.SECTION] > 0


def test_coarser_start_grid_produces_a_smaller_model():
    """The T14 scale lever: raising START_STEP_MIN must shrink the instance."""
    fine = len(generate_windows(SECTIONS, HORIZON_DAYS, start_step_min=60))
    coarse = len(generate_windows(SECTIONS, HORIZON_DAYS, start_step_min=120))
    assert coarse < fine


# --------------------------------------------------------------------------- #
#  scope semantics - the power-block coupling
# --------------------------------------------------------------------------- #


def test_roads_taken_by_scope():
    assert roads_taken(Scope.UP) == (Line.UP,)
    assert roads_taken(Scope.DN) == (Line.DN,)
    assert set(roads_taken(Scope.SECTION)) == {Line.UP, Line.DN}


def test_line_task_may_also_use_a_section_window():
    """This asymmetry IS the clubbing opportunity - do not let it regress."""
    up_task = _task(line=Line.UP)
    wins = generate_windows(SECTIONS, HORIZON_DAYS)
    sec_win = next(w for w in wins if w.scope is Scope.SECTION and w.section == "SEC-01")
    up_win = next(w for w in wins if w.scope is Scope.UP and w.section == "SEC-01")
    dn_win = next(w for w in wins if w.scope is Scope.DN and w.section == "SEC-01")
    assert compatible(up_task, sec_win)
    assert compatible(up_task, up_win)
    assert not compatible(up_task, dn_win)


def test_task_is_never_compatible_with_another_section():
    t = _task(section="SEC-01")
    wins = generate_windows(SECTIONS, HORIZON_DAYS)
    other = next(w for w in wins if w.section == "SEC-02")
    assert not compatible(t, other)


# --------------------------------------------------------------------------- #
#  detention pricing
# --------------------------------------------------------------------------- #


def test_detention_table_is_cumulative_and_starts_at_zero():
    wins = generate_windows(SECTIONS, HORIZON_DAYS)
    w = next(x for x in wins if x.scope is Scope.UP)
    surface = {(s.sid, ln.value): [7] * HORIZON_SLOTS for s in SECTIONS for ln in Line}
    tbl = detention_table(w, surface, SCALE)
    assert tbl[0] == 0
    assert len(tbl) == w.max_dur + 1
    assert all(b >= a for a, b in pairwise(tbl))
    assert tbl[3] == 3 * 7 * SCALE


def test_section_scope_pays_detention_on_both_roads():
    """
    This is what stops the optimiser taking section blocks gratuitously: it has
    to earn them back through clubbing.
    """
    wins = generate_windows(SECTIONS, HORIZON_DAYS)
    surface = {(s.sid, ln.value): [7] * HORIZON_SLOTS for s in SECTIONS for ln in Line}
    up = next(x for x in wins if x.scope is Scope.UP and x.section == "SEC-01")
    sec = next(
        x
        for x in wins
        if x.scope is Scope.SECTION and x.section == "SEC-01" and x.start == up.start
    )
    assert detention_table(sec, surface, SCALE)[4] == 2 * detention_table(
        up, surface, SCALE
    )[4]


# --------------------------------------------------------------------------- #
#  the synthetic generator
# --------------------------------------------------------------------------- #


def test_detention_surface_is_not_flat_and_is_derived_from_the_timetable():
    """
    The premise is that two hours are not alike - if the surface is flat, the
    optimiser has nothing to trade against. That premise survives.

    What did NOT survive is the shape this test used to assert: it required
    03:00 to be under half of 08:00, which was our invented diurnal curve
    written down as an assertion. The measured timetable says otherwise on this
    corridor - 06:00-10:00 is among the QUIETEST windows and midnight is the
    busiest - so the old test was protecting a belief rather than a property.

    This version asserts the property that actually matters, and ties the
    surface to the data it is built from.
    """
    import random

    from engine.core.traffic import TRAFFIC

    surface = detention_surface(SECTIONS, HORIZON_SLOTS, random.Random(0))
    arr = surface[("SEC-01", "UP")]

    #  Genuinely varied: the cheapest hour must be far below the dearest.
    assert min(arr) * 4 < max(arr), "surface is too flat to trade against"

    #  Derived, not invented: the busiest hour of the surface must be the
    #  busiest hour of the measured traffic for that section and day.
    day0 = TRAFFIC[0][0]
    busiest_hour = max(range(24), key=lambda h: day0[h])
    hourly = [arr[h * 4] for h in range(24)]
    assert hourly.index(max(hourly)) == busiest_hour

    #  And it must not depend on the rng at all - it is data now.
    assert surface == detention_surface(SECTIONS, HORIZON_SLOTS, random.Random(999))


def test_generator_is_deterministic_for_a_given_seed():
    a = build_instance(30, seed=11)
    b = build_instance(30, seed=11)
    assert [t.tid for t in a["tasks"]] == [t.tid for t in b["tasks"]]
    assert [t.risk_rate for t in a["tasks"]] == [t.risk_rate for t in b["tasks"]]
    assert a["detention"] == b["detention"]


def test_instance_is_flagged_synthetic():
    """
    Declared synthetic beats discovered synthetic.  If this flag ever goes
    missing the provenance banner silently stops being justified.
    """
    assert build_instance(10, seed=1)["synthetic"] is True


def test_every_trd_task_needs_a_power_block():
    import random

    for t in generate_tasks(SECTIONS, 200, random.Random(3)):
        if t.dept is Department.TRD:
            assert t.needs_power_block


@pytest.mark.parametrize("n", [10, 50])
def test_generated_tasks_book_p90_above_p50(n: int):
    import random

    for t in generate_tasks(SECTIONS, n, random.Random(5)):
        assert t.p90 > t.p50
        assert t.booked == t.p90


def test_hazard_never_exceeds_one():
    import random

    for t in generate_tasks(SECTIONS, 300, random.Random(9)):
        assert 0.0 <= t.hazard <= 1.0
        assert not math.isnan(t.hazard)
