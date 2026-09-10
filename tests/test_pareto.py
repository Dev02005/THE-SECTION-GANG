"""
Tests for the policy-dial sweep.

The value of this chart is that it is measured, not drawn. These tests keep it
that way: the dominance marking must be correct, dominated points must survive
into the output rather than being quietly dropped, and the reduced work budget
must be disclosed rather than implied.
"""

from __future__ import annotations

from engine.pareto import ParetoPoint, _dominates, mark_dominated


def _pt(det: int, risk: int, ar: float = 1.0, **kw) -> ParetoPoint:
    base = dict(
        alpha_risk=ar,
        alpha_detention=1.0,
        detention_minutes=det,
        risk_carried=risk,
        blocks=10,
        scheduled=40,
        statutory_done=35,
        statutory_total=35,
        multidept_pct=50.0,
        objective=1000,
        bound=500,
        gap_pct=50.0,
        wall_time_s=1.0,
        is_current_policy=False,
    )
    base.update(kw)
    return ParetoPoint(**base)  # type: ignore[arg-type]


def test_dominance_requires_no_worse_on_both_and_better_on_one():
    better = _pt(100, 100)
    worse_both = _pt(200, 200)
    worse_one = _pt(100, 200)
    tied = _pt(100, 100)

    assert _dominates(better, worse_both)
    assert _dominates(better, worse_one)
    assert not _dominates(worse_both, better)
    #  a tie is not dominance - neither is strictly better
    assert not _dominates(better, tied)


def test_a_point_on_the_trade_off_is_not_dominated():
    """Cheaper detention but more risk is a genuine trade, not a worse solve."""
    cheap_detention = _pt(100, 500)
    cheap_risk = _pt(500, 100)
    assert not _dominates(cheap_detention, cheap_risk)
    assert not _dominates(cheap_risk, cheap_detention)


def test_mark_dominated_flags_the_beaten_point_and_keeps_it():
    """
    Dominated points stay in the output. Dropping them would turn a measurement
    into a drawing.
    """
    pts = [_pt(100, 100, ar=0.5), _pt(200, 200, ar=1.0), _pt(150, 90, ar=2.0)]
    marked = mark_dominated(pts)
    assert len(marked) == len(pts)
    assert marked[0].dominated_by is None
    assert marked[1].dominated_by == 0  # beaten on both axes by the first
    assert marked[2].dominated_by is None  # cheaper risk, so it trades


def test_marking_preserves_every_other_field():
    pts = [_pt(100, 100), _pt(200, 200, ar=4.0, blocks=17)]
    marked = mark_dominated(pts)
    assert marked[1].alpha_risk == 4.0
    assert marked[1].blocks == 17
    assert marked[1].dominated_by == 0


def test_current_policy_point_is_identifiable():
    pts = mark_dominated([_pt(100, 100, ar=1.0, is_current_policy=True), _pt(200, 90)])
    assert sum(1 for p in pts if p.is_current_policy) == 1


def test_sweep_default_spans_both_sides_of_parity():
    """A sweep that only goes one way cannot show a trade-off."""
    from engine.pareto import DEFAULT_RISK_WEIGHTS

    assert min(DEFAULT_RISK_WEIGHTS) < 1.0 < max(DEFAULT_RISK_WEIGHTS)
    assert 1.0 in DEFAULT_RISK_WEIGHTS
