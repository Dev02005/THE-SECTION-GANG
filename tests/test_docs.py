"""
The documented numbers must match the artefact.

This file exists because the docs have gone stale three separate times - after
the model retrain, after the corridor geometry became real, and again after the
traffic was measured. Each time the figures were corrected by hand, and each
time they rotted at the next solve, because nothing failed when they did.

A claim nobody checks is a claim that drifts. So the README's measured-result
table, the proven floor and the statutory shortfall are now parsed out of the
markdown and compared against `plan.json`. Re-solve without updating the
prose and the suite goes red.

This is the same discipline the rest of the project applies to itself: we take
four rivals apart for publishing numbers their own code does not produce, and
the only thing that keeps us honest at scale is a test.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
LIMITATIONS = ROOT / "docs" / "LIMITATIONS.md"
ARTEFACT = ROOT / "web" / "public" / "data" / "plan.json"


@pytest.fixture(scope="module")
def plan() -> dict:
    return json.loads(ARTEFACT.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def readme() -> str:
    return README.read_text(encoding="utf-8")


def _row(text: str, label: str) -> list[str]:
    """The cells of the markdown table row whose first cell starts with `label`."""
    for line in text.splitlines():
        if line.startswith("|") and line.split("|")[1].strip().startswith(label):
            cells = line.split("|")[1:-1]
            return [c.strip().replace("**", "").replace(",", "") for c in cells]
    raise AssertionError(f"no table row for {label!r} in the README")


def _num(cell: str) -> float:
    m = re.search(r"-?\d+(?:\.\d+)?", cell)
    assert m is not None, f"no number in cell {cell!r}"
    return float(m.group())


#  (README row label, kpis key). Both sides of every headline figure.
PAIRS = [
    ("Blocks granted", "blocks"),
    ("Block-hours on line", "block_hours"),
    ("Train detention", "detention_minutes"),
    ("Detention per task done", "detention_per_task"),
    ("Residual risk carried", "risk_carried"),
    ("Tasks completed", "scheduled"),
    ("Packing", "packing"),
]


@pytest.mark.parametrize(("label", "key"), PAIRS)
def test_readme_table_matches_the_artefact(
    plan: dict, readme: str, label: str, key: str
) -> None:
    cells = _row(readme, label)
    baseline, optimised = _num(cells[1]), _num(cells[2])
    assert baseline == pytest.approx(plan["kpis"]["baseline"][key], rel=0.01), (
        f"README {label!r} baseline is stale"
    )
    assert optimised == pytest.approx(plan["kpis"]["optimised"][key], rel=0.01), (
        f"README {label!r} optimised is stale"
    )


def test_readme_statutory_matches(plan: dict, readme: str) -> None:
    cells = _row(readme, "Statutory closed")
    k = plan["kpis"]
    base, opt = k["baseline"], k["optimised"]
    assert cells[1] == f"{base['statutory_done']}/{base['statutory_total']}"
    assert cells[2] == f"{opt['statutory_done']}/{opt['statutory_total']}"


def test_readme_clubbing_matches(plan: dict, readme: str) -> None:
    cells = _row(readme, "Multi-department blocks")
    pct = plan["kpis"]["optimised"]["multidept_pct"]
    assert _num(cells[2]) == pytest.approx(pct, rel=0.01)


def test_the_proven_floor_is_quoted_correctly(plan: dict) -> None:
    """
    The floor is the one number no rival can produce, so a stale one would be
    the most expensive error in the project.
    """
    floor = plan["placement"]["bound"]
    text = LIMITATIONS.read_text(encoding="utf-8")
    assert f"{floor:,}" in text, (
        f"docs/LIMITATIONS.md does not quote the current proven floor {floor:,}"
    )


def test_shortfall_count_is_not_understated(plan: dict) -> None:
    """
    Five statutory tasks are unplaceable, not one. Understating this is the
    exact flattery we criticise elsewhere, so it gets an assertion.
    """
    n = len(plan["shortfall"])
    text = LIMITATIONS.read_text(encoding="utf-8")
    heading = re.search(r"## 5\. Statutory obligation: (\d+) of (\d+)", text)
    assert heading is not None, "LIMITATIONS section 5 heading is missing or renamed"
    done, total = int(heading.group(1)), int(heading.group(2))
    assert done == plan["kpis"]["optimised"]["statutory_done"]
    assert total == plan["kpis"]["optimised"]["statutory_total"]
    assert total - done == n, f"heading implies {total - done} misses, artefact has {n}"
    for entry in plan["shortfall"]:
        tid = entry["taskId"]
        assert tid in text, f"{tid} is not named in the limitations"
