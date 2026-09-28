"""
Tests for the pre-approval checks.

The shipped plan must pass every check - and each check must FAIL when its
rule is broken. A validator that passes everything is worse than none: it
would put a green tick on the approval card for a plan nobody checked. So
every test below breaks the real plan in exactly one way and asserts that the
check responsible notices.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from engine.core.corridor import protected_paths
from engine.core.schema import SLOTS_DAY
from engine.core.synthetic import build_instance
from engine.models.pricing import price_instance
from engine.validate import all_passed, check_plan

ROOT = Path(__file__).resolve().parent.parent
ARTEFACT = ROOT / "web" / "public" / "data" / "plan.json"


@pytest.fixture(scope="module")
def shipped():
    return json.loads(ARTEFACT.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def instance(shipped):
    n = len(shipped["optimised"]["tasks"])
    return price_instance(build_instance(n, seed=shipped["provenance"]["seed"]))


@pytest.fixture
def plan(shipped):
    return copy.deepcopy(shipped)


def failed(payload, instance) -> set[str]:
    return {c["id"] for c in check_plan(payload, instance) if not c["passed"]}


def placed(plan):
    return [t for t in plan["optimised"]["tasks"] if t["scheduled"]]


def test_the_shipped_plan_passes_every_check(shipped, instance):
    checks = check_plan(shipped, instance)
    assert all_passed(checks), [c for c in checks if not c["passed"]]
    assert len(checks) == 12


def test_a_block_moved_off_its_window_is_caught(plan, instance):
    plan["optimised"]["blocks"][0]["startSlot"] += 1
    assert "C1" in failed(plan, instance)


def test_two_blocks_on_one_road_at_once_are_caught(plan, instance):
    blocks = plan["optimised"]["blocks"]
    a = next(b for b in blocks if b["scope"] == "SECTION")
    b = next(x for x in blocks if x is not a and x["section"] == a["section"])
    b["startSlot"] = a["startSlot"]
    assert "C7" in failed(plan, instance)


def test_a_block_across_a_protected_train_is_caught(plan, instance):
    p0, _ = protected_paths(instance["horizon_slots"] // SLOTS_DAY)[0]
    plan["optimised"]["blocks"][0]["startSlot"] = p0
    assert "PROT" in failed(plan, instance)


def test_a_job_missing_from_its_block_is_caught(plan, instance):
    block = next(b for b in plan["optimised"]["blocks"] if b["tasks"])
    block["tasks"] = block["tasks"][1:]
    assert "C2" in failed(plan, instance)


def test_an_empty_block_is_caught(plan, instance):
    plan["optimised"]["blocks"][0]["tasks"] = []
    assert "C2" in failed(plan, instance)


def test_a_job_on_the_wrong_section_is_caught(plan, instance):
    t = placed(plan)[0]
    other = next(w for w in instance["windows"] if w.section != t["section"])
    t["blockId"] = other.wid
    assert "FIT" in failed(plan, instance)


def test_work_before_protection_is_caught(plan, instance):
    t = placed(plan)[0]
    block = next(b for b in plan["optimised"]["blocks"] if b["id"] == t["blockId"])
    t["startSlot"] = block["startSlot"]
    assert "C6" in failed(plan, instance)


def test_work_cut_short_is_caught(plan, instance):
    t = placed(plan)[0]
    t["endSlot"] = t["startSlot"] + 1
    assert "C6" in failed(plan, instance)


def test_a_job_after_its_due_date_is_caught(plan, instance):
    due = {x.tid: x.due_slot for x in instance["tasks"]}
    t = placed(plan)[0]
    t["endSlot"] = due[t["id"]] + 1
    assert "C4" in failed(plan, instance)


def test_the_tower_wagon_in_two_places_is_caught(plan, instance):
    wagon = {x.tid for x in instance["tasks"] if "TOWER_WAGON" in x.resources}
    a, b = [t for t in placed(plan) if t["id"] in wagon][:2]
    b["startSlot"], b["endSlot"] = a["startSlot"], a["endSlot"]
    assert "C8" in failed(plan, instance)


def test_too_many_blocks_in_a_day_are_caught(plan, instance):
    blocks = [b for b in plan["optimised"]["blocks"] if b["section"] == "SEC-01"]
    for b in blocks:
        b["day"] = 0
    assert len(blocks) > 2
    assert "C9" in failed(plan, instance)


def test_too_many_night_blocks_are_caught(plan, instance):
    nights = [w for w in instance["windows"] if w.night and w.section == "SEC-01"][:5]
    template = plan["optimised"]["blocks"][0]
    plan["optimised"]["blocks"] += [
        {**copy.deepcopy(template), "id": w.wid, "section": w.section, "day": w.day}
        for w in nights
    ]
    assert "C10" in failed(plan, instance)


def test_a_job_before_its_predecessor_is_caught(plan, instance):
    job = placed(plan)[0]
    unplaced = next(t for t in plan["optimised"]["tasks"] if not t["scheduled"])
    tasks = [x.model_copy(update={"predecessors": [unplaced["id"]]})
             if x.tid == job["id"] else x for x in instance["tasks"]]
    assert "C11" in failed(plan, {**instance, "tasks": tasks})


def test_an_undeclared_statutory_miss_is_caught(plan, instance):
    plan["shortfall"] = plan["shortfall"][1:]
    assert "STAT" in failed(plan, instance)


def test_the_published_checks_are_of_the_published_plan(shipped, instance):
    """
    checks.json travels beside plan.json. Rebuild the plan and forget the
    checks, and the site would show a green set for a plan nobody checked.
    """
    path = ROOT / "web" / "public" / "data" / "checks.json"
    if not path.exists():
        pytest.skip("checks.json not built - run python -m engine.build_checks")
    published = json.loads(path.read_text(encoding="utf-8"))
    assert published["plan"] == {
        "objective": shipped["solver"]["objective"],
        "seed": shipped["provenance"]["seed"],
        "blocks": len(shipped["optimised"]["blocks"]),
        "generatedAt": shipped["generatedAt"],
    }, "checks.json is of a different build - run python -m engine.build_checks"
    assert published["checks"] == check_plan(shipped, instance)
