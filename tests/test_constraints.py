"""
One test per constraint, C1 through C11.

The pattern is the same throughout and it is the important part: build a small
instance in which the constraint under test is the ONLY thing preventing an
obviously better solution, then assert the model does not take it.

A constraint that is written but not tested is a constraint that silently is
not enforced - and here that means shipping a plan nobody can execute.

    python -m pytest tests -q
"""

from __future__ import annotations

from itertools import pairwise

import pytest

from engine.core.candidates import compatible
from engine.core.corridor import SECTIONS, Corridor
from engine.core.schema import (
    HORIZON_SLOTS,
    SLOTS_DAY,
    CandidateWindow,
    Criticality,
    Department,
    Line,
    Scope,
    Section,
    Task,
)
from engine.core.synthetic import build_instance
from engine.solver.config import (
    CLEAR_SLOTS,
    MAX_BLOCKS_PER_SECTION_DAY,
    MAX_NIGHT_BLOCKS_PER_SECTION_WEEK,
    SETUP_SLOTS,
)
from engine.solver.model import solve

# --------------------------------------------------------------------------- #
#  builders
# --------------------------------------------------------------------------- #


def mk_task(
    tid: str = "T1",
    dept: Department = Department.ENGG,
    section: str = "SEC-01",
    line: Line = Line.UP,
    p90: int = 4,
    due: int = HORIZON_SLOTS,
    crit: Criticality = Criticality.B,
    resources: dict[str, int] | None = None,
    power: bool = False,
    hazard: float = 0.05,
    consequence: int = 500,
    preds: list[str] | None = None,
) -> Task:
    return Task(
        tid=tid,
        dept=dept,
        section=section,
        line=line,
        km=1.0,
        activity="test activity",
        criticality=crit,
        p50=max(1, p90 - 1),
        p90=p90,
        due_slot=due,
        hazard=hazard,
        consequence=consequence,
        resources=resources or {"GANG": 1},
        needs_power_block=power,
        predecessors=preds or [],
    )


def mk_window(
    wid: str = "W1",
    section: str = "SEC-01",
    scope: Scope = Scope.UP,
    day: int = 0,
    start: int = 44,
    max_dur: int = 12,
    night: bool = False,
) -> CandidateWindow:
    return CandidateWindow(
        wid=wid,
        section=section,
        scope=scope,
        day=day,
        start=start,
        max_dur=max_dur,
        power_block=True,
        night=night,
    )


def instance(
    tasks: list[Task],
    windows: list[CandidateWindow],
    resources: dict[str, int] | None = None,
    sections: tuple[Section, ...] | None = None,
    cost: int = 10,
) -> dict:
    secs = sections or (SECTIONS[0],)
    surface = {
        (s.sid, ln.value): [cost] * HORIZON_SLOTS
        for s in secs
        for ln in (Line.UP, Line.DN)
    }
    return {
        "sections": secs,
        "tasks": tasks,
        "windows": windows,
        "detention": surface,
        "resources": resources
        or {
            "GANG": 5,
            "TAMPER": 1,
            "USFD": 2,
            "SNT_CREW": 2,
            "TRD_CREW": 2,
            "TOWER_WAGON": 1,
        },
        "horizon_slots": HORIZON_SLOTS,
    }


def run(inst: dict, time_limit_s: float = 20.0):
    plan = solve(inst, time_limit_s=time_limit_s)
    assert plan.stats.status in ("OPTIMAL", "FEASIBLE"), plan.stats.status
    return plan


def block_of(plan, tid: str):
    return next((b for b in plan.blocks if tid in b.tasks), None)


def task_of(plan, tid: str):
    return next(t for t in plan.tasks if t.tid == tid)


# --------------------------------------------------------------------------- #
#  C1  block duration bounds
# --------------------------------------------------------------------------- #


def test_c1_granted_block_meets_minimum_duration():
    """A two-minute job still needs a block of at least the policy minimum."""
    plan = run(instance([mk_task(p90=1, crit=Criticality.A)], [mk_window()]))
    b = block_of(plan, "T1")
    assert b is not None
    assert b.dur >= Corridor.MIN_BLOCK_SLOTS


def test_c1_duration_never_exceeds_corridor_cap():
    """Longer than the corridor allows: place it short, or not at all."""
    inst = instance([mk_task(p90=20, crit=Criticality.A)], [mk_window(max_dur=8)])
    plan = solve(inst, time_limit_s=20.0)
    for b in plan.blocks:
        assert b.dur <= 8


# --------------------------------------------------------------------------- #
#  C2  a task goes into at most one window
# --------------------------------------------------------------------------- #


def test_c2_task_assigned_to_at_most_one_window():
    wins = [mk_window("W1", start=44), mk_window("W2", start=100)]
    plan = run(instance([mk_task(crit=Criticality.A)], wins))
    assert len([b for b in plan.blocks if "T1" in b.tasks]) == 1


# --------------------------------------------------------------------------- #
#  C3  statutory work
# --------------------------------------------------------------------------- #


def test_c3_criticality_a_scheduled_even_when_expensive():
    """
    Cheap to defer by risk, expensive to place by detention.  Without C3 the
    optimiser would defer it.  With C3 it must not.
    """
    t = mk_task("A1", crit=Criticality.A, hazard=1e-6, consequence=1)
    plan = run(instance([t], [mk_window(max_dur=12)], cost=500))
    assert task_of(plan, "A1").scheduled


def test_c3_relaxes_gracefully_when_backlog_exceeds_corridor():
    """
    Six statutory tasks, one narrow window, one gang.  Infeasible as a hard
    constraint.  The system must still return a plan plus a shortfall list -
    an optimiser that just says INFEASIBLE is useless in an operating railway.
    """
    tasks = [
        mk_task(f"A{i}", crit=Criticality.A, p90=6, resources={"GANG": 1})
        for i in range(6)
    ]
    inst = instance(tasks, [mk_window(max_dur=8)], resources={"GANG": 1})
    plan = solve(inst, time_limit_s=20.0)
    assert plan.stats.status in ("OPTIMAL", "FEASIBLE")
    assert plan.shortfall, "expected a shortfall list, not a full plan"
    assert not plan.statutory_hard
    assert all(s.binding_constraint for s in plan.shortfall)


# --------------------------------------------------------------------------- #
#  C4  due dates
# --------------------------------------------------------------------------- #


def test_c4_task_finishes_before_its_due_date():
    due = 2 * SLOTS_DAY
    wins = [mk_window("Wearly", day=0, start=44), mk_window("Wlate", day=5, start=524)]
    plan = run(instance([mk_task("D1", crit=Criticality.A, due=due, p90=4)], wins))
    line = task_of(plan, "D1")
    assert line.scheduled and line.end is not None and line.end <= due


# --------------------------------------------------------------------------- #
#  C5  no empty blocks
# --------------------------------------------------------------------------- #


def test_c5_no_empty_blocks_are_granted():
    wins = [mk_window(f"W{i}", start=40 + 14 * i) for i in range(4)]
    plan = run(instance([mk_task("T1", crit=Criticality.A)], wins))
    for b in plan.blocks:
        assert b.tasks, f"block {b.wid} granted with no tasks"


# --------------------------------------------------------------------------- #
#  C6  containment, protection and clearance
# --------------------------------------------------------------------------- #


def test_c6_work_sits_inside_the_block_with_protection_and_clearance():
    w = mk_window(start=44, max_dur=12)
    plan = run(instance([mk_task("C1", crit=Criticality.A, p90=4)], [w]))
    line, b = task_of(plan, "C1"), block_of(plan, "C1")
    assert b is not None and line.start is not None and line.end is not None
    assert line.start >= w.start + SETUP_SLOTS, "work started before protection"
    assert line.end + CLEAR_SLOTS <= w.start + b.dur, "no clearance time left"


# --------------------------------------------------------------------------- #
#  C7  line occupation and the power-block coupling
# --------------------------------------------------------------------------- #


def test_c7_two_blocks_cannot_hold_the_same_road_at_once():
    tasks = [
        mk_task("T1", line=Line.UP, crit=Criticality.A),
        mk_task("T2", line=Line.UP, crit=Criticality.A),
    ]
    wins = [
        mk_window("W1", scope=Scope.UP, start=44, max_dur=12),
        mk_window("W2", scope=Scope.UP, start=46, max_dur=12),
    ]
    plan = run(instance(tasks, wins))
    up = sorted(
        [b for b in plan.blocks if b.scope in (Scope.UP, Scope.SECTION)],
        key=lambda b: b.start,
    )
    for a, b in pairwise(up):
        assert a.start + a.dur <= b.start, "overlapping blocks on the UP road"


def test_c7_power_block_takes_both_roads_down():
    """
    While a SECTION block runs, no DN-road block may be granted at the same
    time.  This coupling is what makes OHE work expensive - and therefore worth
    clubbing.
    """
    ohe = mk_task(
        "O1",
        dept=Department.TRD,
        line=Line.BOTH,
        crit=Criticality.A,
        power=True,
        resources={"TOWER_WAGON": 1, "TRD_CREW": 1},
    )
    pway = mk_task("P1", dept=Department.ENGG, line=Line.DN, crit=Criticality.A)
    wins = [
        mk_window("Wsec", scope=Scope.SECTION, start=44, max_dur=12),
        mk_window("Wdn", scope=Scope.DN, start=46, max_dur=12),
    ]
    plan = run(instance([ohe, pway], wins))
    for s in [b for b in plan.blocks if b.scope is Scope.SECTION]:
        for d in [b for b in plan.blocks if b.scope is Scope.DN]:
            assert d.start + d.dur <= s.start or s.start + s.dur <= d.start


def test_c7_ohe_task_never_compatible_with_a_line_scope_window():
    ohe = mk_task(
        "O1", dept=Department.TRD, line=Line.BOTH, power=True, crit=Criticality.A
    )
    assert not compatible(ohe, mk_window("Wup", scope=Scope.UP))
    assert compatible(ohe, mk_window("Wsec", scope=Scope.SECTION))


# --------------------------------------------------------------------------- #
#  C8  resource capacity
# --------------------------------------------------------------------------- #


def test_c8_single_tower_wagon_serialises_ohe_work():
    """
    Two OHE jobs in different sections, one tower wagon.  They must not run
    concurrently even though the sections are independent.  This is the classic
    binding constraint and the model must find it without being told.
    """
    secs = SECTIONS[:2]
    tasks = [
        mk_task(
            "O1",
            dept=Department.TRD,
            section="SEC-01",
            line=Line.BOTH,
            power=True,
            crit=Criticality.A,
            p90=6,
            resources={"TOWER_WAGON": 1},
        ),
        mk_task(
            "O2",
            dept=Department.TRD,
            section="SEC-02",
            line=Line.BOTH,
            power=True,
            crit=Criticality.A,
            p90=6,
            resources={"TOWER_WAGON": 1},
        ),
    ]
    wins = [
        mk_window("W1", section="SEC-01", scope=Scope.SECTION, start=44, max_dur=12),
        mk_window("W2", section="SEC-02", scope=Scope.SECTION, start=44, max_dur=12),
    ]
    inst = instance(
        tasks,
        wins,
        resources={"TOWER_WAGON": 1, "TRD_CREW": 2, "GANG": 3},
        sections=secs,
    )
    plan = run(inst)
    a, b = task_of(plan, "O1"), task_of(plan, "O2")
    if a.scheduled and b.scheduled:
        assert a.end <= b.start or b.end <= a.start, "tower wagon double-booked"


def test_c8_gang_capacity_is_respected():
    tasks = [
        mk_task(f"G{i}", crit=Criticality.A, p90=4, resources={"GANG": 1})
        for i in range(4)
    ]
    plan = run(
        instance(tasks, [mk_window("W1", start=44, max_dur=12)], resources={"GANG": 2})
    )
    sched = [t for t in plan.tasks if t.scheduled]
    for slot in range(HORIZON_SLOTS):
        busy = sum(1 for t in sched if t.start <= slot < t.end)
        assert busy <= 2, f"{busy} gangs in use at slot {slot}"


# --------------------------------------------------------------------------- #
#  C9 / C10  operating-rule caps
# --------------------------------------------------------------------------- #


def test_c9_blocks_per_section_per_day_capped():
    tasks = [mk_task(f"T{i}", crit=Criticality.A, p90=3) for i in range(6)]
    wins = [
        mk_window(f"W{i}", day=0, start=40 + 13 * i, max_dur=12) for i in range(6)
    ]
    plan = run(instance(tasks, wins, resources={"GANG": 6}))
    per_day: dict[tuple[str, int], int] = {}
    for b in plan.blocks:
        per_day[(b.section, b.day)] = per_day.get((b.section, b.day), 0) + 1
    for key, n in per_day.items():
        assert n <= MAX_BLOCKS_PER_SECTION_DAY, f"{key} has {n} blocks"


def test_c10_night_blocks_capped_per_week():
    tasks = [mk_task(f"N{i}", crit=Criticality.A, p90=3) for i in range(10)]
    wins = [
        mk_window(
            f"WN{i}", day=i % 7, start=(i % 7) * SLOTS_DAY + 6, max_dur=12, night=True
        )
        for i in range(10)
    ]
    plan = run(instance(tasks, wins, resources={"GANG": 10}))
    night_ids = {w.wid for w in wins}
    n = sum(1 for b in plan.blocks if b.wid in night_ids)
    assert n <= MAX_NIGHT_BLOCKS_PER_SECTION_WEEK


# --------------------------------------------------------------------------- #
#  C11  technological precedence
# --------------------------------------------------------------------------- #


def test_c11_usfd_test_precedes_rail_renewal():
    test = mk_task("USFD", crit=Criticality.A, p90=3)
    renew = mk_task("RENEW", crit=Criticality.A, p90=3, preds=["USFD"])
    wins = [
        mk_window("W1", day=0, start=44, max_dur=12),
        mk_window("W2", day=2, start=236, max_dur=12),
    ]
    plan = run(instance([test, renew], wins, resources={"GANG": 2}))
    a, b = task_of(plan, "USFD"), task_of(plan, "RENEW")
    if b.scheduled:
        assert a.scheduled, "renewal scheduled without its predecessor"
        assert a.end <= b.start, "renewal starts before USFD testing finishes"


# --------------------------------------------------------------------------- #
#  objective behaviour - not a constraint, but the point of the system
# --------------------------------------------------------------------------- #


def test_clubbing_is_preferred_when_it_is_cheaper():
    """Three departments, one section: collapse into one block, not three."""
    tasks = [
        mk_task("E1", dept=Department.ENGG, line=Line.UP, crit=Criticality.A, p90=3),
        mk_task(
            "S1",
            dept=Department.SNT,
            line=Line.UP,
            crit=Criticality.A,
            p90=3,
            resources={"SNT_CREW": 1},
        ),
        mk_task(
            "R1",
            dept=Department.TRD,
            line=Line.BOTH,
            crit=Criticality.A,
            p90=3,
            power=True,
            resources={"TOWER_WAGON": 1, "TRD_CREW": 1},
        ),
    ]
    wins = [
        mk_window("Wsec", scope=Scope.SECTION, day=0, start=44, max_dur=12),
        mk_window("Wup", scope=Scope.UP, day=1, start=140, max_dur=12),
        mk_window("Wsec2", scope=Scope.SECTION, day=2, start=236, max_dur=12),
    ]
    plan = run(instance(tasks, wins))
    assert [b for b in plan.blocks if b.clubbed], "optimiser did not club any work"


def test_high_risk_task_is_scheduled_before_low_risk_task():
    hi = mk_task("HI", crit=Criticality.B, hazard=0.5, consequence=900, p90=3)
    lo = mk_task("LO", crit=Criticality.B, hazard=1e-4, consequence=50, p90=3)
    wins = [
        mk_window("Wearly", day=0, start=44, max_dur=12),
        mk_window("Wlate", day=5, start=524, max_dur=12),
    ]
    plan = run(instance([hi, lo], wins, resources={"GANG": 1}))
    h, low = task_of(plan, "HI"), task_of(plan, "LO")
    if h.scheduled and low.scheduled:
        assert h.start <= low.start, "low-risk work scheduled ahead of high-risk"
    else:
        assert h.scheduled, "the high-risk task was the one dropped"


# --------------------------------------------------------------------------- #
#  reproducibility - an acceptance criterion, not a nicety
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", [3, 11])
def test_plan_is_reproducible_for_the_same_seed(seed: int):
    """
    Controllers will not trust a system whose plan changes when nothing else
    did.  Deterministic mode must return the identical plan every run.
    """
    a = solve(build_instance(40, seed=seed), time_limit_s=25.0)
    b = solve(build_instance(40, seed=seed), time_limit_s=25.0)
    assert a.stats.objective == b.stats.objective
    assert {x.wid for x in a.blocks} == {x.wid for x in b.blocks}


def test_bound_is_reported_and_valid():
    """The bound is the argument for CP-SAT over a metaheuristic. Surface it."""
    plan = solve(build_instance(30, seed=5), time_limit_s=25.0)
    assert plan.stats.bound is not None
    assert plan.stats.bound <= plan.stats.objective
    assert plan.stats.gap_pct is not None and plan.stats.gap_pct >= 0.0
