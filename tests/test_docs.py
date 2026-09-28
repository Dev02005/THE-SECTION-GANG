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
    data = json.loads(REPLAN.read_text(encoding="utf-8"))
    #  The README describes the FEATURED disruption; the page offers the rest.
    r = next(s for s in data["scenarios"] if s["id"] == data["featured"])
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


PITCH = ROOT / "docs" / "PITCH.md"
IMPLEMENTATION = ROOT / "docs" / "IMPLEMENTATION.md"
LIMITS_PAGE = ROOT / "web" / "app" / "limits" / "page.tsx"


def _flat(text: str) -> str:
    """Markdown with blockquote markers and line breaks folded to single spaces."""
    return re.sub(r"\s+", " ", re.sub(r"\n>\s?", " ", text))


def test_every_statutory_count_in_the_docs_is_one_the_artefact_holds(
    plan: dict,
) -> None:
    """
    PITCH.md told the room statutory went "20 of 35 to 34 of 35" while the
    artefact, the README and a later paragraph of the same file said 21 to 30.
    It was the one doc nothing read. Every "N of 35" or "N/35" in any of them
    must now be the baseline's figure or the plan's.
    """
    k = plan["kpis"]
    total = k["optimised"]["statutory_total"]
    held = {k["baseline"]["statutory_done"], k["optimised"]["statutory_done"]}
    pat = re.compile(rf"\b(\d+)\s*(?:/|of)\s*{total}\b")
    for doc in (README, LIMITATIONS, PITCH, IMPLEMENTATION):
        for m in pat.finditer(doc.read_text(encoding="utf-8")):
            assert int(m.group(1)) in held, (
                f"{doc.name} states {m.group(0)!r}; the artefact holds "
                f"{sorted(held)} of {total}"
            )


WORDS = {w: i for i, w in enumerate((
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen",
))}


def test_pitch_quotes_explanations_the_artefact_contains(plan: dict) -> None:
    """
    The pitch reads block explanations aloud. Its quotes - "750 against 464",
    and a block where sharing cost more, which was a whole stage moment - had
    stopped being true when the corridor was re-priced, and nothing noticed.
    Every figure it quotes from an explanation must be a block in the artefact.
    """
    text = _flat(PITCH.read_text(encoding="utf-8"))
    ex = list(plan["explanations"].values())
    shared = [e for e in ex if e["clubbing"]]

    quotes = re.findall(r"would cost (\d+) detention-minutes against (\d+) here", text)
    assert quotes, "PITCH.md no longer quotes a block explanation; update this test"
    pairs = {(c["clubbing"]["separate_detention"], c["clubbing"]["actual_detention"])
             for c in shared}
    for sep, act in quotes:
        assert (int(sep), int(act)) in pairs, (
            f"PITCH quotes {sep} against {act}; no block in the artefact says that"
        )

    places = {
        (e["placement"]["cheapest_alternative"], e["placement"]["penalty_vs_cheapest"])
        for e in ex
    }
    for alt, pen in re.findall(
        r"would have cost \*\*(\d+)\*\*, so this slot costs \*\*(\d+) more\*\*", text
    ):
        assert (int(alt), int(pen)) in places, (
            f"PITCH says a cheapest window of {alt}, {pen} more; no block says that"
        )

    m = re.search(r"(\w+) of the (\w+) shared blocks carry a line like that", text)
    if m:
        paid = sum(1 for c in shared if c["placement"]["penalty_vs_cheapest"] > 0)
        said = (WORDS[m.group(1).lower()], WORDS[m.group(2).lower()])
        assert said == (paid, len(shared)), (
            f"PITCH says {m.group(0)!r}; the artefact has {paid} of {len(shared)}"
        )
    m = re.search(r"the smallest saving is (\d+) minutes", text)
    if m:
        least = min(c["clubbing"]["detention_saved"] for c in shared)
        assert int(m.group(1)) == least, (
            f"PITCH says the smallest saving is {m.group(1)}; it is {least}"
        )


def test_the_priced_surface_is_described_as_it_is_built(plan: dict) -> None:
    """
    Until 28 Sep the notice on every page, LIMITATIONS §1b and /limits all said
    the detention surface came from the published timetable. The shipped plan
    is priced by the detention model, whose input is a hand-set daily curve
    that never read the timetable. So the words now follow the code: while the
    model does not read engine.core.traffic, the artefact must say the shape is
    assumed and no doc may say it is measured. Wire the timetable in and this
    test says to change the words back.
    """
    if "detention" not in plan["provenance"]["pricedBy"]:
        pytest.skip("this artefact is not priced by the detention model")
    src = (ROOT / "engine" / "models" / "detention.py").read_text(encoding="utf-8")
    notice = plan["provenance"]["notice"]
    if "engine.core.traffic" in src:
        assert "assumed" not in notice, (
            "the model reads the timetable now; update the notice"
        )
        return
    assert "assumed" in notice, "the notice must say the detention shape is assumed"
    for doc, claim in (
        (LIMITATIONS, "no longer a shape we invented"),
        (README, "traffic and protected paths are measured"),
        (LIMITS_PAGE, "timetable, not assumed"),
    ):
        assert claim not in doc.read_text(encoding="utf-8"), (
            f"{doc.name} still says the priced surface is measured ({claim!r})"
        )


def test_limits_page_and_limitations_name_the_same_unbuilt_things() -> None:
    """
    /limits carries a hand copy of LIMITATIONS §6. By 28 Sep four of its eight
    headings no longer matched the markdown, and the markdown had filed the
    approval chain and supersession - both built - under "not built". The two
    lists must now name exactly the same things.
    """
    md = LIMITATIONS.read_text(encoding="utf-8")
    sec = md[md.index("## 6. What is designed but not built"):md.index("## 6b.")]
    in_md = re.findall(r"^- \*\*(.+?)\.\*\*", sec, re.M)

    page = LIMITS_PAGE.read_text(encoding="utf-8")
    blk = page[page.index('title="Designed but not built"'):]
    blk = blk[:blk.index("</DocSection>")]
    on_page = re.findall(r'^\s*\["([^"]+)", "', blk, re.M)

    assert in_md and on_page, "one of the two lists could not be read"
    assert sorted(in_md) == sorted(on_page), (
        f"only in LIMITATIONS: {sorted(set(in_md) - set(on_page))}; "
        f"only on /limits: {sorted(set(on_page) - set(in_md))}"
    )


BENCHMARK = ROOT / "web" / "public" / "data" / "benchmark.json"


def test_the_scale_table_matches_the_benchmark() -> None:
    """
    LIMITATIONS §7 carried the 4 Sep ladder - 576 candidate windows and 3,940
    variables at 90 tasks - long after the engine had changed under it. /scale
    read the file and stayed current; the markdown was typed and did not. Every
    row of the table must now be a row of benchmark.json, timings included,
    and every rung must appear.
    """
    bench = json.loads(BENCHMARK.read_text(encoding="utf-8"))
    rows = {r["tasks"]: r for r in bench["rows"]}
    md = LIMITATIONS.read_text(encoding="utf-8")
    sec = md[md.index("## 7. Scale"):md.index("## 8.")]
    seen: set[int] = set()
    for line in sec.splitlines():
        cells = [
            c.strip().replace("**", "").replace(",", "") for c in line.split("|")[1:-1]
        ]
        if len(cells) != 6 or not cells[0].isdigit():
            continue
        tasks, sections, nvars, build, solve, status = cells
        r = rows.get(int(tasks))
        assert r is not None, f"LIMITATIONS §7 has a {tasks}-task row the benchmark lacks"
        assert (int(sections), int(nvars), status) == (
            r["sections"], r["assignment_vars"], r["status"]
        ), f"LIMITATIONS §7, {tasks} tasks, is stale against benchmark.json"
        assert build == f"{r['build_time_s']:.1f}s", f"{tasks}-task build is stale"
        assert solve == f"{round(r['solve_time_s'])}s", f"{tasks}-task solve is stale"
        seen.add(int(tasks))
    missing = sorted(set(rows) - seen)
    assert not missing, f"LIMITATIONS §7 is missing rungs {missing}"


MONTHLY = ROOT / "web" / "public" / "data" / "monthly.json"


def test_monthly_claims_match_the_artefact() -> None:
    """
    The README, LIMITATIONS and the pitch state what the month measured - how
    much of week 1 the weekly solver fits, how the deferrals split. Each of
    those is one build of the month; prose that outlives it is the drift this
    file exists to stop.
    """
    if not MONTHLY.exists():
        pytest.skip("monthly.json not built - run python -m engine.build_monthly")
    m = json.loads(MONTHLY.read_text(encoding="utf-8"))
    h, t = m["handoff"], m["totals"]
    fit = f"{h['scheduled']} of {h['allocated']}"
    priced = sum(d["reason"].startswith("priced") for d in m["deferred"])
    noroom = sum(d["reason"].startswith("no room") for d in m["deferred"])
    #  "60 of 66" in prose, "60 of the 66" where the pitch is read aloud
    said = re.compile(rf"(?<!\d){h['scheduled']} of (?:the )?{h['allocated']}(?!\d)")
    for doc in (README, LIMITATIONS, PITCH):
        text = _flat(doc.read_text(encoding="utf-8")).replace("**", "")
        assert said.search(text), f"{doc.name} does not state that week 1 fits {fit}"
    lim = _flat(LIMITATIONS.read_text(encoding="utf-8")).replace("**", "")
    assert f"{priced} priced out" in lim and f"{noroom} with no room" in lim, (
        "LIMITATIONS 6c misstates how the month's deferrals split"
    )
    assert f"{t['statutoryPlaced']} of {t['statutoryTotal']}" in lim
    slipped = sum(x["criticality"] == "A" for x in h["misses"])
    assert f"{slipped} slip" in lim, "LIMITATIONS must say how many statutory jobs slip"


CHECKS = ROOT / "web" / "public" / "data" / "checks.json"


def test_checks_and_disruption_claims_match_the_artefacts(readme: str) -> None:
    """
    The README states how many pre-approval checks there are and how many
    disruptions the replan page offers. Add a check or a scenario and forget
    the prose, and this fails.
    """
    if not (CHECKS.exists() and REPLAN.exists()):
        pytest.skip("checks.json or replan.json not built")
    checks = json.loads(CHECKS.read_text(encoding="utf-8"))["checks"]
    scenarios = json.loads(REPLAN.read_text(encoding="utf-8"))["scenarios"]
    text = _flat(readme).replace("**", "")
    assert f"{len(checks)} pre-approval checks" in text, "README check count is stale"
    assert f"{len(scenarios)} disruptions to choose from" in text, (
        "README disruption count is stale"
    )
    costly = [s for s in scenarios if s["lost"]]
    assert f"{len(costly)} cost a statutory job" in text
