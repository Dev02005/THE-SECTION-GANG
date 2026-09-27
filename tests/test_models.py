"""
Tests for the prediction layer.

The most important tests here are the ones asserting that each promotion gate
REJECTS a bad model.  A gate that cannot fail is decoration, and a registry
that promotes anything is not a registry.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from engine.models import detention, duration, hazard
from engine.models import features as F
from engine.models.registry import (
    ModelCard,
    current_version,
    load,
    new_version,
    train_and_gate,
)

# --------------------------------------------------------------------------- #
#  the gates must be able to fail
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("metrics", "expect"),
    [
        ({"coverage_p90": 0.72, "coverage_p50": 0.50, "padding_ratio": 1.2}, "coverage"),
        ({"coverage_p90": 0.99, "coverage_p50": 0.50, "padding_ratio": 1.2}, "coverage"),
        ({"coverage_p90": 0.90, "coverage_p50": 0.20, "padding_ratio": 1.2}, "coverage"),
        ({"coverage_p90": 0.90, "coverage_p50": 0.50, "padding_ratio": 2.4}, "padding"),
    ],
)
def test_duration_gate_rejects_bad_models(metrics: dict, expect: str) -> None:
    reason = duration.gate(metrics)
    assert reason is not None and expect in reason


def test_duration_gate_accepts_a_calibrated_model() -> None:
    assert (
        duration.gate(
            {"coverage_p90": 0.90, "coverage_p50": 0.50, "padding_ratio": 1.25}
        )
        is None
    )


@pytest.mark.parametrize(
    ("metrics", "expect"),
    [
        ({"brier_skill": -0.1, "concordance": 0.70}, "Brier"),
        ({"brier_skill": 0.05, "concordance": 0.52}, "below 0.60"),
        ({"brier_skill": 0.05, "concordance": 0.99}, "leakage"),
    ],
)
def test_hazard_gate_rejects_bad_models(metrics: dict, expect: str) -> None:
    """A concordance of 0.99 on survival data is leakage, not skill."""
    reason = hazard.gate(metrics)
    assert reason is not None and expect in reason


def test_detention_gate_rejects_a_model_that_cannot_beat_the_mean() -> None:
    assert detention.gate({"skill_vs_naive": 0.10}) is not None
    assert detention.gate({"skill_vs_naive": 0.55}) is None


# --------------------------------------------------------------------------- #
#  registry - and the Windows trap
# --------------------------------------------------------------------------- #


def test_registry_roundtrip_and_pointer_is_a_plain_file(tmp_path, monkeypatch) -> None:
    """
    `current` must be a text file, not a symlink.  os.symlink needs a privilege
    an ordinary Windows user does not have and raises WinError 1314 - which is
    exactly how the reference implementation dies on this machine.
    """
    monkeypatch.setattr("engine.models.registry.REGISTRY_ROOT", tmp_path)
    card = ModelCard(
        name="toy",
        version=new_version(),
        trained_at=datetime.now(UTC).isoformat(),
        rows_trained=10,
        backend="test",
        metrics={"ok": 1.0},
    )
    out = train_and_gate("toy", {"weights": [1, 2, 3]}, card, lambda _m: None)
    assert out.passed_gate

    pointer = tmp_path / "toy" / "current.txt"
    assert pointer.is_file() and not pointer.is_symlink()
    assert current_version("toy") == card.version

    obj, loaded = load("toy")
    assert obj == {"weights": [1, 2, 3]}
    assert loaded.version == card.version


def test_failing_gate_saves_but_does_not_promote(tmp_path, monkeypatch) -> None:
    """A failed gate keeps the previous model live and records why."""
    monkeypatch.setattr("engine.models.registry.REGISTRY_ROOT", tmp_path)
    card = ModelCard(
        name="toy",
        version=new_version(),
        trained_at=datetime.now(UTC).isoformat(),
        rows_trained=10,
        backend="test",
        metrics={"bad": 1.0},
    )
    out = train_and_gate("toy", {"x": 1}, card, lambda _m: "coverage too low")
    assert not out.passed_gate
    assert "GATE FAILED" in out.notes
    assert (tmp_path / "toy" / card.version / "model.pkl").exists()  # saved
    assert current_version("toy") is None  # but not promoted


def test_load_without_a_promoted_model_raises(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("engine.models.registry.REGISTRY_ROOT", tmp_path)
    with pytest.raises(FileNotFoundError):
        load("never-trained")


# --------------------------------------------------------------------------- #
#  conformal calibration - the technical differentiator
# --------------------------------------------------------------------------- #


def test_conformal_delta_lifts_coverage_toward_the_target() -> None:
    """
    The whole claim is that the raw quantile fit under-covers and the conformal
    step fixes it.  If this ever stops being true, the claim must come off the
    slide too.
    """
    rows, y = duration.synth_history(1500, seed=11)
    _model, metrics = duration.train(rows, y)
    assert metrics["coverage_raw_p90"] < metrics["coverage_p90"]
    assert abs(metrics["coverage_p90"] - 0.90) < abs(metrics["coverage_raw_p90"] - 0.90)


def test_conformal_delta_is_the_right_order_statistic() -> None:
    res = np.arange(100, dtype=float)
    d = duration.conformal_delta(res, 0.9)
    assert 88.0 <= d <= 92.0


def test_pinball_penalises_under_prediction_harder_at_p90() -> None:
    y = np.array([100.0])
    under = duration.pinball(y, np.array([90.0]), 0.9)
    over = duration.pinball(y, np.array([110.0]), 0.9)
    assert under > over * 5


def test_booked_slots_rounds_up_never_down() -> None:
    """Rounding a duration down is how a block returns late."""
    rows, y = duration.synth_history(600, seed=3)
    model, _ = duration.train(rows, y)
    minutes = model.predict(rows[:20], 0.9)
    slots = model.booked_slots(rows[:20], slot_minutes=15)
    for mins, s in zip(minutes, slots, strict=True):
        assert s * 15 >= mins


# --------------------------------------------------------------------------- #
#  hazard pricing
# --------------------------------------------------------------------------- #


def test_consequence_table_is_a_published_policy_input() -> None:
    """
    This is where railway judgment enters the system. It must stay visible and
    arguable rather than being learned into model weights.
    """
    assert hazard.CONSEQUENCE_MINUTES["RAIL"] > hazard.CONSEQUENCE_MINUTES["SIGNAL"]
    assert all(v > 0 for v in hazard.CONSEQUENCE_MINUTES.values())


def test_risk_rate_prices_a_degraded_rail_far_above_a_fresh_signal() -> None:
    rows, events, holdout = hazard.synth_assets(400, seed=5)
    model, _ = hazard.train(rows, events, holdout)
    ex = [
        dict(
            age_years=22, gmt=48, prior_defects=4, overdue_days=95,
            condition=0.8, period=6,
            **F.one_hot("RAIL", hazard.ASSET_TYPES, "at"),
        ),
        dict(
            age_years=3, gmt=9, prior_defects=0, overdue_days=2,
            condition=0.1, period=0,
            **F.one_hot("SIGNAL", hazard.ASSET_TYPES, "at"),
        ),
    ]
    rates, cold = model.risk_rates(ex, ["RAIL", "SIGNAL"])
    assert rates[0] > 10 * rates[1]
    assert cold == [False, False]


def test_unknown_asset_type_falls_back_to_schedule_and_is_flagged() -> None:
    """
    Cold start must be visible. Showing a schedule-driven price as if it were
    condition-driven would mislead the planner.
    """
    rows, events, holdout = hazard.synth_assets(300, seed=5)
    model, _ = hazard.train(rows, events, holdout)
    ex = [
        dict(
            age_years=5, gmt=20, prior_defects=1, overdue_days=200,
            condition=0.5, period=0,
            **F.one_hot("RAIL", hazard.ASSET_TYPES, "at"),
        )
    ]
    rates, cold = model.risk_rates(ex, ["BRIDGE"], overdue_days=[200.0])
    assert cold == [True]
    assert rates[0] >= 1


# --------------------------------------------------------------------------- #
#  detention surface
# --------------------------------------------------------------------------- #


def test_surface_is_cheaper_at_night_than_at_the_morning_peak() -> None:
    """
    Tests the ASSUMED curve in `detention.path_density`, which prices 08:00 as a
    peak. The measured timetable says 08:00 is quiet on this corridor
    (LIMITATIONS §1b). When the model moves to measured densities this test
    has to move with it - not be kept passing by keeping the old curve.
    """
    rows, y = detention.synth_traffic(20, seed=3)
    model, _ = detention.train(rows, y)
    surf = model.surface(96, datetime(2026, 3, 2, tzinfo=UTC))
    arr = surf[("SEC-01", "UP")]
    assert arr[3 * 4] < arr[8 * 4] / 2


def test_surface_covers_every_section_and_road() -> None:
    rows, y = detention.synth_traffic(20, seed=3)
    model, _ = detention.train(rows, y)
    surf = model.surface(96, datetime(2026, 3, 2, tzinfo=UTC))
    assert len(surf) == len(detention.SECTION_IDS) * 2
    assert all(len(v) == 96 and all(x >= 1 for x in v) for v in surf.values())


# --------------------------------------------------------------------------- #
#  the point-in-time rule
# --------------------------------------------------------------------------- #


def test_point_in_time_store_never_returns_a_future_value() -> None:
    """
    Training on values known only afterwards gives excellent offline metrics
    and useless field performance, and it fails without any error message.
    """
    store = F.PointInTimeStore()
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    store.write("RAIL-1", "condition", t0, 0.2)
    store.write("RAIL-1", "condition", t0 + timedelta(days=30), 0.9)
    assert store.as_of("RAIL-1", "condition", t0 + timedelta(days=10)) == 0.2
    assert store.as_of("RAIL-1", "condition", t0 + timedelta(days=40)) == 0.9
    assert store.as_of("RAIL-1", "condition", t0 - timedelta(days=1)) is None


def test_hash_category_is_stable_across_processes() -> None:
    """Python's salted hash() would give a different vector on every run."""
    assert F.hash_category("GANG-07") == F.hash_category("GANG-07")
    assert F.hash_category("GANG-07") != F.hash_category("GANG-08")


def test_split_indices_are_disjoint() -> None:
    """Conformal coverage is void if the calibration fold leaks into train."""
    tr, cal, te = F.split_indices(1000, test_frac=0.25, calib_frac=0.15, seed=0)
    assert len(set(tr) & set(cal)) == 0
    assert len(set(tr) & set(te)) == 0
    assert len(set(cal) & set(te)) == 0
    assert len(tr) + len(cal) + len(te) == 1000


# --------------------------------------------------------------------------- #
#  pricing integration - where the models meet the optimiser
# --------------------------------------------------------------------------- #


def test_pricing_is_reproducible_across_processes() -> None:
    """
    Python's builtin hash() is salted per process. Using it to pick a gang gave
    every task a different feature vector on every run, so the plan never
    reproduced - and it was silent, because within one process it looked fine.
    This asserts the stable hash is used instead.
    """
    import subprocess
    import sys

    script = (
        "import sys; sys.path.insert(0,'.');"
        "from engine.core.synthetic import build_instance;"
        "from engine.models.pricing import price_instance;"
        "i = price_instance(build_instance(20, seed=7));"
        "print(sum(t.p90 for t in i['tasks']), sum(t.risk_rate for t in i['tasks']))"
    )
    outs = {
        subprocess.run(
            [sys.executable, "-c", script], capture_output=True, text=True, check=True
        ).stdout.strip()
        for _ in range(3)
    }
    assert len(outs) == 1, f"pricing differs across processes: {outs}"


def test_price_instance_does_not_mutate_the_original() -> None:
    from engine.core.synthetic import build_instance
    from engine.models.pricing import price_instance

    raw = build_instance(15, seed=7)
    before = [(t.p90, t.hazard) for t in raw["tasks"]]
    price_instance(raw)
    assert [(t.p90, t.hazard) for t in raw["tasks"]] == before


def test_price_instance_records_which_models_were_applied() -> None:
    """We never claim a number came from a model when it did not."""
    from engine.core.synthetic import build_instance
    from engine.models.pricing import price_instance

    priced = price_instance(build_instance(15, seed=7))
    assert set(priced["priced_by"]) <= {"duration", "hazard", "detention"}
    assert set(priced["model_versions"]) == set(priced["priced_by"])


def test_booked_durations_fit_inside_a_corridor_block() -> None:
    """
    The bug that made two thirds of the backlog unschedulable: the duration
    model and the corridor policy disagreed about how long a job takes.
    """
    from engine.core.corridor import Corridor
    from engine.core.synthetic import build_instance
    from engine.models.pricing import price_instance
    from engine.solver.config import CLEAR_SLOTS, SETUP_SLOTS

    usable = Corridor.MAX_BLOCK_SLOTS - SETUP_SLOTS - CLEAR_SLOTS
    priced = price_instance(build_instance(60, seed=7))
    over = [t.tid for t in priced["tasks"] if t.p90 > usable]
    assert not over, f"{len(over)} tasks cannot fit any block: {over[:5]}"


def test_unknown_activity_is_rejected_not_silently_defaulted() -> None:
    from engine.core.synthetic import build_instance
    from engine.models.pricing import price_instance

    inst = build_instance(5, seed=7)
    inst["tasks"] = [inst["tasks"][0].model_copy(update={"activity": "Nonsense job"})]
    with pytest.raises(KeyError, match="shared vocabulary"):
        price_instance(inst)


def test_schedule_hazard_rises_with_overdue_days() -> None:
    assert hazard.schedule_hazard("BRIDGE", 0) < hazard.schedule_hazard("BRIDGE", 400)
    assert hazard.schedule_hazard("BRIDGE", 10_000) <= 0.5
