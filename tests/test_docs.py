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


def test_binding_constraints_in_the_docs_match_the_artefact(plan: dict) -> None:
    """
    The shortfall table in LIMITATIONS.md names the binding constraint against
    each task, and those strings were typed by hand. They are the sentence a
    DRM carries to the zonal meeting, and they changed the moment the
    constraints were renamed - so they get an assertion rather than a promise.
    """
    text = LIMITATIONS.read_text(encoding="utf-8")
    for entry in plan["shortfall"]:
        binding = entry["bindingConstraint"]
        assert binding in text, (
            f"{entry['taskId']} is attributed to {binding!r} in the artefact, "
            f"and docs/LIMITATIONS.md does not say so"
        )


def test_constraint_names_are_not_presented_as_rulebook_citations() -> None:
    """
    The eleven constraints are named in operating language on purpose. Labelling
    them as General and Subsidiary Rules would be a citation we have not
    checked, which is the one thing this project refuses to do - so if anyone
    ever writes G&SR next to them, this fails.
    """
    for doc in (README, LIMITATIONS):
        text = doc.read_text(encoding="utf-8")
        for cid in (f"C{n}" for n in range(1, 12)):
            assert f"G&SR-{cid}" not in text and f"G&SR {cid}" not in text, (
                f"{doc.name} labels {cid} as a G&SR rule; we have not verified "
                "our constraints against that rulebook"
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


#  Where the suite's size is stated. Each is required to be present: a claim
#  that quietly disappears is how a check stops checking.
COUNT_CLAIMS = (
    ("README.md", r"pytest tests -q\s+#\s+(\d+) tests"),
    ("README.md", r"tests/\s+(\d+) tests [-—] one per constraint"),
    ("../CLAUDE.md", r"tests/\s+(\d+) tests, one per constraint"),
)


def test_the_stated_test_count_matches_the_suite(request: pytest.FixtureRequest) -> None:
    """
    The README said "148 tests" in two places while 150 existed, because the
    Phase 1 guards were added and the prose was not. Small, but it is the same
    drift bug the rest of this file exists to catch, and a count is the easiest
    number in the project to check.

    Counting `def test_` would be wrong - 137 functions expand to 151 cases
    through parametrise - so this asks pytest what it actually collected. That
    figure only means something for a whole-suite run, so a partial run skips
    rather than failing spuriously.

    Only the three current claim sites are read. CLAUDE.md also records counts
    from earlier tasks ("99 tests green"), which are history and must not be
    dragged forward to today's number.
    """
    collected = request.session.items
    ran = {Path(str(item.fspath)).name for item in collected}
    whole = {p.name for p in (ROOT / "tests").glob("test_*.py")}
    if ran != whole:
        pytest.skip("partial run; the count means nothing without the whole suite")

    n = len(collected)
    for name, pattern in COUNT_CLAIMS:
        doc = ROOT / name
        if not doc.exists():
            #  CLAUDE.md is not shipped in the published repository.
            assert name.startswith(".."), f"{name} is missing from the repo"
            continue
        m = re.search(pattern, doc.read_text(encoding="utf-8"))
        assert m is not None, (
            f"{name} no longer states the test count where this test looks "
            f"({pattern!r}); update the pattern or restore the claim"
        )
        assert int(m.group(1)) == n, (
            f"{name} says {m.group(1)} tests; pytest collected {n}"
        )


REPLAN = ROOT / "web" / "public" / "data" / "replan.json"


def test_readme_replan_claims_match_the_artefact(readme: str) -> None:
    """
    The README states the replan's outcome in prose - "7 of 10 approved blocks
    are untouched", "one more gang and nothing is lost", "one more USFD unit
    does not help". Each of those is a measurement of one scenario, and the
    scenario can be rebuilt. Prose that outlives the numbers under it is the
    drift this file exists to stop, so the claims are read against replan.json.
    """
    if not REPLAN.exists():
        pytest.skip("replan.json not built - run python -m engine.build_replan")
    r = json.loads(REPLAN.read_text(encoding="utf-8"))
    d = r["diff"]
    total = len(d["kept"]) + len(d["changed"]) + len(d["dropped"])
    assert f"{len(d['kept'])} of {total} approved" in readme, (
        f"README does not state {len(d['kept'])} of {total} approved blocks untouched"
    )
    by_res = {c["resource"]: c for c in r["counterfactuals"]}
    gang, usfd = by_res.get("GANG"), by_res.get("USFD")
    assert gang is not None and gang["avoidsTheLoss"], (
        "README claims one more gang avoids the loss"
    )
    assert gang["minChanges"] == 0, (
        "README claims no approved job changes with one more gang"
    )
    assert usfd is not None and not usfd["avoidsTheLoss"], (
        "README claims one more USFD unit does not help"
    )
    assert len(r["lost"]) == 1, "README says ONE statutory job is deferred"
    assert r["result"]["statutoryProven"], "README says the loss is proven unavoidable"
