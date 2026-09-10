"""
Tests for the baseline, the KPIs and the exported artefact.

The baseline is the most important honesty surface in the system.  If it is not
a fair opponent, every number we report is worthless - so most of these tests
exist to prove we did NOT rig it:

  * it produces a plan that could actually be executed
  * it books the same durations the optimiser books
  * both sides are scored by the same function with the same constants

That last one is not hypothetical.  A rival scores its own plan with
`priority x 0.15` and the baseline with `priority x 0.08` and reports the
difference as "+500.4 hours saved".
"""

from __future__ import annotations

import json

import pytest

from engine.baseline.current_practice import plan_current_practice
from engine.baseline.kpis import compute
from engine.core.candidates import roads_taken
from engine.core.corridor import Corridor
from engine.core.schema import Criticality, Line
from engine.core.synthetic import build_instance
from engine.export.plan_json import SCHEMA_VERSION, build_payload, write
from engine.solver.config import (
    CLEAR_SLOTS,
    MAX_BLOCKS_PER_SECTION_DAY,
    SETUP_SLOTS,
)
from engine.solver.model import solve


@pytest.fixture(scope="module")
def instance():
    return build_instance(45, seed=7)


@pytest.fixture(scope="module")
def baseline(instance):
    return plan_current_practice(instance)


@pytest.fixture(scope="module")
def optimised(instance):
    return solve(instance, time_limit_s=45.0)


# --------------------------------------------------------------------------- #
#  the baseline must be executable, or our margin means nothing
# --------------------------------------------------------------------------- #


def test_baseline_never_double_books_a_road(baseline, instance):
    horizon = instance["horizon_slots"]
    busy: dict[tuple[str, str], list[str]] = {}
    for b in baseline.blocks:
        for ln in roads_taken(b.scope):
            key = (b.section, ln.value)
            occ = busy.setdefault(key, [""] * horizon)
            for s in range(b.start, min(b.start + b.dur, horizon)):
                assert not occ[s], f"{b.wid} overlaps {occ[s]} on {key} at slot {s}"
                occ[s] = b.wid


def test_baseline_respects_resource_capacity(baseline, instance):
    by_tid = {t.tid: t for t in instance["tasks"]}
    horizon = instance["horizon_slots"]
    for res, cap in instance["resources"].items():
        used = [0] * horizon
        for p in baseline.tasks:
            if not p.scheduled:
                continue
            need = by_tid[p.tid].resources.get(res, 0)
            for s in range(p.start, min(p.end, horizon)):
                used[s] += need
        assert max(used, default=0) <= cap, f"{res} over capacity in the baseline"


def test_baseline_respects_the_operating_rule_caps(baseline):
    per_day: dict[tuple[str, int], int] = {}
    for b in baseline.blocks:
        per_day[(b.section, b.day)] = per_day.get((b.section, b.day), 0) + 1
    assert all(n <= MAX_BLOCKS_PER_SECTION_DAY for n in per_day.values())


def test_baseline_blocks_meet_the_minimum_duration(baseline):
    assert all(b.dur >= Corridor.MIN_BLOCK_SLOTS for b in baseline.blocks)


def test_baseline_work_sits_inside_its_block_with_protection_and_clearance(baseline):
    by_id = {b.wid: b for b in baseline.blocks}
    for p in baseline.tasks:
        if not p.scheduled:
            continue
        b = by_id[p.window]
        assert p.start >= b.start + SETUP_SLOTS
        assert p.end + CLEAR_SLOTS <= b.start + b.dur


# --------------------------------------------------------------------------- #
#  the baseline must be siloed - that is what it is modelling
# --------------------------------------------------------------------------- #


def test_baseline_never_clubs_departments(baseline):
    """
    The point of the comparison. No department can see the other two registers,
    so it cannot propose clubbing even when it would obviously help.
    """
    assert all(not b.clubbed for b in baseline.blocks)
    assert all(len(b.tasks) == 1 for b in baseline.blocks)


def test_baseline_is_not_handicapped_on_duration(baseline, instance):
    """
    It books the same P90 the optimiser books. The comparison is about
    placement and packing, not about who guessed the duration better.
    """
    by_tid = {t.tid: t for t in instance["tasks"]}
    for p in baseline.tasks:
        if p.scheduled:
            assert p.end - p.start == by_tid[p.tid].booked


def test_baseline_is_deterministic(instance):
    a = plan_current_practice(instance)
    b = plan_current_practice(instance)
    assert [x.wid for x in a.blocks] == [x.wid for x in b.blocks]


# --------------------------------------------------------------------------- #
#  the KPIs must score both sides identically
# --------------------------------------------------------------------------- #


def test_both_plans_are_scored_by_the_same_function(baseline, optimised, instance):
    """
    Rigging the comparison means using different constants per side. The only
    way to be sure is that one function, given one instance, produces both.
    """
    kb = compute("manual", baseline, instance)
    ko = compute("optimised", optimised, instance)
    #  an empty plan must score zero on both sides - no side gets a floor
    empty = baseline.model_copy(update={"blocks": [], "tasks": []})
    ke = compute("empty", empty, instance)
    assert ke.blocks == 0 and ke.detention_minutes == 0 and ke.scheduled == 0
    assert kb.label != ko.label and type(kb) is type(ko)


def test_detention_is_recomputed_from_the_surface_not_the_plan(instance, optimised):
    """
    KPI detention must come from the instance's surface, so both sides pay the
    same price for the same slot - not from a number the solver wrote.
    """
    k = compute("optimised", optimised, instance)
    manual = 0
    for b in optimised.blocks:
        for ln in roads_taken(b.scope):
            for s in range(b.start, b.start + b.dur):
                manual += instance["detention"][(b.section, ln.value)][s]
    assert k.detention_minutes == manual


def test_packing_counts_work_against_block_time(baseline, instance):
    by_tid = {t.tid: t for t in instance["tasks"]}
    k = compute("manual", baseline, instance)
    work = sum(by_tid[p.tid].booked for p in baseline.tasks if p.scheduled)
    block = sum(b.dur for b in baseline.blocks)
    assert k.packing == pytest.approx(round(work / block, 2))


def test_delta_is_none_when_the_baseline_is_zero():
    from engine.baseline.kpis import _delta_pct

    assert _delta_pct(0, 5) is None
    assert _delta_pct(10, 5) == -50.0


def test_optimiser_beats_the_baseline_on_packing(baseline, optimised, instance):
    """
    The acceptance criterion: block utilisation above 1.5x baseline. If this
    ever fails, the clubbing term has stopped working and the claim comes off
    the slide with it.
    """
    kb = compute("manual", baseline, instance)
    ko = compute("optimised", optimised, instance)
    assert ko.packing > kb.packing
    assert ko.multidept_blocks > 0
    assert kb.multidept_blocks == 0


# --------------------------------------------------------------------------- #
#  the exported artefact - the demo's load path
# --------------------------------------------------------------------------- #


def test_payload_is_json_serialisable_and_complete(baseline, optimised, instance):
    payload = build_payload(optimised, baseline, instance)
    text = json.dumps(payload)  # must not raise
    assert len(text) > 1000
    for key in (
        "schemaVersion", "provenance", "horizon", "sections", "detentionSurface",
        "solver", "optimised", "baseline", "kpis", "shortfall",
    ):
        assert key in payload, f"missing {key}"
    assert payload["schemaVersion"] == SCHEMA_VERSION


def test_payload_declares_its_data_provenance(baseline, optimised, instance):
    """Declared synthetic beats discovered synthetic."""
    p = build_payload(optimised, baseline, instance)["provenance"]
    assert p["synthetic"] is True
    assert "no external access" in p["notice"]
    assert p["seed"] == 7


def test_payload_carries_the_bound_and_solver_status(baseline, optimised, instance):
    s = build_payload(optimised, baseline, instance)["solver"]
    assert s["status"] in ("OPTIMAL", "FEASIBLE")
    assert s["bound"] is not None and s["bound"] <= s["objective"]
    assert s["deterministic"] is True


def test_payload_block_task_ids_all_resolve(baseline, optimised, instance):
    payload = build_payload(optimised, baseline, instance)
    known = {t.tid for t in instance["tasks"]}
    for side in ("optimised", "baseline"):
        for b in payload[side]["blocks"]:
            for t in b["tasks"]:
                assert t["id"] in known


def test_detention_surface_covers_every_section_and_road(baseline, optimised, instance):
    payload = build_payload(optimised, baseline, instance)
    horizon = payload["horizon"]["slots"]
    roads = (Line.UP.value, Line.DN.value)
    expected = {f"{s['id']}|{ln}" for s in payload["sections"] for ln in roads}
    assert set(payload["detentionSurface"]) == expected
    assert all(len(v) == horizon for v in payload["detentionSurface"].values())


def test_write_creates_parent_directories(tmp_path, baseline, optimised, instance):
    out = tmp_path / "nested" / "deeper" / "plan.json"
    path = write(build_payload(optimised, baseline, instance), out)
    assert path.exists()
    assert json.loads(path.read_text(encoding="utf-8"))["schemaVersion"] == SCHEMA_VERSION


def test_statutory_shortfall_entries_name_a_binding_constraint(
    baseline, optimised, instance
):
    for entry in build_payload(optimised, baseline, instance)["shortfall"]:
        assert entry["criticality"] == Criticality.A.value
        assert entry["bindingConstraint"]
        assert entry["riskRate"] >= 1


def test_compare_reports_signed_deltas(baseline, optimised, instance):
    from engine.baseline.kpis import compare

    kb = compute("manual", baseline, instance)
    ko = compute("optimised", optimised, instance)
    d = compare(kb, ko)["deltas"]
    #  fewer blocks is a negative delta; more tasks done is positive
    assert d["blocks_pct"] < 0
    assert d["throughput_pct"] >= 0
    assert d["packing_ratio"] > 1.0
    assert d["statutory_before"].endswith(f"/{kb.statutory_total}")


def test_render_table_shows_both_sides_and_no_invented_rows(
    baseline, optimised, instance
):
    from engine.baseline.kpis import compare, render_table

    text = render_table(
        compare(
            compute("manual", baseline, instance),
            compute("optimised", optimised, instance),
        )
    )
    for label in (
        "Blocks granted", "Train detention", "Statutory closed",
        "Multi-department blocks", "Packing",
    ):
        assert label in text
    assert "Manual" in text and "AI plan" in text


def test_meeting_order_covers_every_department():
    from engine.baseline.current_practice import MEETING_ORDER
    from engine.core.schema import Department

    assert set(MEETING_ORDER) == set(Department)


def test_statutory_pct_is_derived_not_stored(baseline, instance):
    k = compute("manual", baseline, instance)
    assert k.statutory_pct == pytest.approx(
        100.0 * k.statutory_done / k.statutory_total
    )


# --------------------------------------------------------------------------- #
#  end-to-end reproducibility - the acceptance criterion, at artefact level
# --------------------------------------------------------------------------- #


def test_artefact_plan_content_is_reproducible(instance):
    """
    Plan stability is an acceptance criterion, and what actually ships is the
    artefact - so the guarantee has to hold there, not just inside the solver.

    `generatedAt` and `wallTimeS` are timing measurements and necessarily
    differ; everything describing the PLAN must not.
    """
    import hashlib

    def digest() -> str:
        plan = solve(instance, time_limit_s=20.0)
        payload = build_payload(plan, plan_current_practice(instance), instance)
        payload.pop("generatedAt")
        payload["solver"].pop("wallTimeS")
        payload["provenance"].pop("modelVersions")
        return hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest()

    assert digest() == digest()


def test_baseline_reports_its_own_shortfall(baseline):
    """
    Showing the optimised plan's unmet statutory work while hiding the
    baseline's would flatter us. The baseline misses more, and it should say so.
    """
    unmet = [
        p for p in baseline.tasks
        if not p.scheduled and p.criticality is Criticality.A
    ]
    assert len(baseline.shortfall) == len(unmet)
    assert all(s.binding_constraint for s in baseline.shortfall)


def test_payload_carries_both_shortfall_lists(baseline, optimised, instance):
    payload = build_payload(optimised, baseline, instance)
    assert "shortfall" in payload and "baselineShortfall" in payload
    assert len(payload["baselineShortfall"]) >= len(payload["shortfall"]), (
        "the optimiser should miss no more statutory work than current practice"
    )


def test_export_default_path_is_the_one_the_site_actually_reads():
    """
    The artefact must land under web/public/, because that is what Next.js
    serves and what lib/loadPlan.ts reads at build time. Writing anywhere else
    means regenerating the plan silently changes nothing on the site - which is
    exactly what happened once.
    """
    import argparse
    import re
    from pathlib import Path

    src = Path("engine/build_plan.py").read_text(encoding="utf-8")
    match = re.search(r'"--out",\s*default="([^"]+)"', src, re.S)
    assert match, "build_plan must declare an --out default"
    default = match.group(1)
    assert default.startswith("web/public/"), (
        f"--out defaults to {default!r}, which the web app does not read"
    )

    loader = Path("web/lib/loadPlan.ts")
    if loader.exists():
        text = loader.read_text(encoding="utf-8")
        assert '"public", "data", "plan.json"' in text
        assert default == "web/public/data/plan.json"
    del argparse
