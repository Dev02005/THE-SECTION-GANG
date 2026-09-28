"""
Pre-approval checks: the published plan, re-checked against every hard rule.

Independent of the solver by construction. This module reads the ARTEFACT -
the plan.json the site serves and the database seeds from - and the rebuilt
instance, and imports nothing from engine.solver's model: not the variables,
not the constraints, not the objective. A bug in how a constraint was posted
to CP-SAT cannot hide from a check that never saw the model.

Each check answers one question an approving officer would ask, and reports
what it examined and the first few failures by name. A plan that fails any of
them is never written: engine.build_plan refuses, and the site will not let a
plan be submitted or approved without a passing set.

What these checks are not: citations of the General and Subsidiary Rules. They
are this model's own rules, named the way a division says them, and checked.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from engine.core.candidates import compatible, roads_taken
from engine.core.corridor import Corridor, blackout_days, protected_paths
from engine.core.schema import SLOTS_DAY, Criticality, Scope
from engine.solver.config import (
    CLEAR_SLOTS,
    MAX_BLOCKS_PER_SECTION_DAY,
    MAX_NIGHT_BLOCKS_PER_SECTION_WEEK,
    SETUP_SLOTS,
)

SHOW = 5  # failures named per check; the count is always complete


def _result(cid: str, name: str, examined: int, fails: list[str]) -> dict[str, Any]:
    return {
        "id": cid,
        "name": name,
        "passed": not fails,
        "examined": examined,
        "failed": len(fails),
        "failures": fails[:SHOW],
    }


def check_plan(payload: dict[str, Any], instance: dict[str, Any]) -> list[dict[str, Any]]:
    """Every check, in the order an officer would read them."""
    plan = payload["optimised"]
    blocks = plan["blocks"]
    tasks = {t["id"]: t for t in plan["tasks"]}
    spec = {t.tid: t for t in instance["tasks"]}
    wins = {w.wid: w for w in instance["windows"]}
    horizon = instance["horizon_slots"]
    by_id = {b["id"]: b for b in blocks}

    def span(b: dict[str, Any]) -> tuple[int, int]:
        return b["startSlot"], b["startSlot"] + b["durSlots"]

    out: list[dict[str, Any]] = []

    # 1. every block is a sanctioned window, used as the corridor allows
    f: list[str] = []
    off = blackout_days()
    for b in blocks:
        w = wins.get(b["id"])
        if w is None:
            f.append(f"{b['id']}: not a permitted window")
            continue
        if (b["section"], b["scope"], b["startSlot"]) != (
                w.section, w.scope.value, w.start):
            f.append(f"{b['id']}: section, scope or start differs from its window")
        if not Corridor.MIN_BLOCK_SLOTS <= b["durSlots"] <= w.max_dur:
            lo, hi = Corridor.MIN_BLOCK_SLOTS, w.max_dur
            f.append(f"{b['id']}: {b['durSlots']} slots outside {lo}-{hi}")
        if w.day % 7 in off:
            f.append(f"{b['id']}: on a blackout day")
    out.append(_result("C1", "Every block inside its sanctioned window", len(blocks), f))

    # 2. one block per road at a time
    f = []
    for i, a in enumerate(blocks):
        for b in blocks[i + 1:]:
            if a["section"] != b["section"]:
                continue
            roads_a = set(roads_taken(Scope(a["scope"])))
            shared = roads_a & set(roads_taken(Scope(b["scope"])))
            (a0, a1), (b0, b1) = span(a), span(b)
            if shared and a0 < b1 and b0 < a1:
                f.append(f"{a['id']} and {b['id']} hold the same road at once")
    out.append(_result("C7", "One block per road at a time", len(blocks), f))

    # 3. no block across a protected premium train
    f = []
    trains = protected_paths(horizon // SLOTS_DAY)
    for b in blocks:
        b0, b1 = span(b)
        if any(b0 < p1 and p0 < b1 for p0, p1 in trains):
            f.append(f"{b['id']}: crosses a protected train path")
    out.append(_result("PROT", "No block across a protected train", len(blocks), f))

    # 4. no empty block, no job half-placed
    f = []
    members: dict[str, list[str]] = defaultdict(list)
    for b in blocks:
        if not b["tasks"]:
            f.append(f"{b['id']}: granted with no work in it")
        for bt in b["tasks"]:
            members[bt["id"]].append(b["id"])
    for tid, t in tasks.items():
        where = members.get(tid, [])
        if t["scheduled"] and (len(where) != 1 or where[0] != t["blockId"]):
            f.append(f"{tid}: placed, but listed in {len(where)} blocks")
        if not t["scheduled"] and (where or t["blockId"]):
            f.append(f"{tid}: deferred, but still in a block")
    out.append(_result("C2", "No empty block, no job half-placed", len(tasks), f))

    placed = [t for t in tasks.values() if t["scheduled"]]

    # 5. right section, road and scope for each job
    f = []
    for t in placed:
        w = wins.get(t["blockId"])
        if w is None or not compatible(spec[t["id"]], w):
            f.append(f"{t['id']}: wrong section, road or scope for {t['blockId']}")
    out.append(_result("FIT", "Right section, road and scope for each job",
                       len(placed), f))

    # 6. work inside protection and clearance, and not cut short
    f = []
    for t in placed:
        b = by_id.get(t["blockId"])
        if b is None:
            f.append(f"{t['id']}: in a block that is not in the plan")
            continue
        b0, b1 = span(b)
        if t["startSlot"] < b0 + SETUP_SLOTS or t["endSlot"] > b1 - CLEAR_SLOTS:
            f.append(f"{t['id']}: runs outside protection and clearance in {b['id']}")
        if t["endSlot"] - t["startSlot"] < spec[t["id"]].booked:
            f.append(f"{t['id']}: shorter than its booked duration")
    out.append(_result("C6", "Work inside protection and clearance", len(placed), f))

    # 7. every placed job finished by its due date
    f = [f"{t['id']}: ends after its due date"
         for t in placed if t["endSlot"] > spec[t["id"]].due_slot]
    out.append(_result("C4", "Every placed job done by its due date", len(placed), f))

    # 8. machines and gangs never double-booked
    f = []
    load: dict[tuple[str, int], int] = defaultdict(int)
    for t in placed:
        for r, q in spec[t["id"]].resources.items():
            for s in range(t["startSlot"], t["endSlot"]):
                load[(r, s)] += q
    for (r, s), used in sorted(load.items()):
        if used > instance["resources"].get(r, 0):
            f.append(f"{r}: {used} needed at slot {s}, "
                     f"{instance['resources'].get(r, 0)} available")
    out.append(_result("C8", "Machines and gangs never double-booked",
                       len(instance["resources"]), f))

    # 9-10. blocks per section per day, and night blocks per section per week
    per_day: dict[tuple[str, int], int] = defaultdict(int)
    nights: dict[str, int] = defaultdict(int)
    for b in blocks:
        per_day[(b["section"], b["day"])] += 1
        if b["id"] in wins and wins[b["id"]].night:
            nights[b["section"]] += 1
    f = [f"{s} day {d + 1}: {n} blocks" for (s, d), n in sorted(per_day.items())
         if n > MAX_BLOCKS_PER_SECTION_DAY]
    out.append(_result("C9", f"At most {MAX_BLOCKS_PER_SECTION_DAY} blocks per section "
                             "per day", len(per_day), f))
    f = [f"{s}: {n} night blocks" for s, n in sorted(nights.items())
         if n > MAX_NIGHT_BLOCKS_PER_SECTION_WEEK]
    out.append(_result("C10", f"At most {MAX_NIGHT_BLOCKS_PER_SECTION_WEEK} night blocks "
                              "per section per week", len(nights), f))

    # 11. predecessors finish first
    f = []
    checked = 0
    for t in placed:
        for p in spec[t["id"]].predecessors:
            checked += 1
            pt = tasks.get(p)
            if pt is None or not pt["scheduled"] or pt["endSlot"] > t["startSlot"]:
                f.append(f"{t['id']}: starts before {p} is done")
    out.append(_result("C11", "Predecessors finish first", checked, f))

    # 12. every statutory job left out is declared, with the reason
    f = []
    named = {s["taskId"]: s for s in payload.get("shortfall", [])}
    missed = [t for t in tasks.values()
              if t["criticality"] == Criticality.A.value and not t["scheduled"]]
    for t in missed:
        entry = named.get(t["id"])
        if entry is None or not entry.get("bindingConstraint"):
            f.append(f"{t['id']}: statutory, not placed, and not declared")
    out.append(_result("STAT", "Every statutory job left out is declared, with "
                               "its reason", len(missed), f))
    return out


def all_passed(checks: list[dict[str, Any]]) -> bool:
    return all(c["passed"] for c in checks)
