"""
Build the replan artefact.

    python -m engine.build_replan

Writes web/public/data/replan.json, beside plan.json and separate from it: the
approved plan, its fingerprint and the seeded database are left untouched, and
nothing has to be re-run in Supabase.

It REFUSES to write if the plan it rebuilds is not the plan that shipped. The
replan is of a specific week; rebuilding a subtly different one and replanning
that would be the manufactured-result failure in its purest form. The check is
the objective and the block count, both of which the deterministic solve
reproduces exactly (verified: 36,639,101 and 18, in a separate process).

The counterfactual is not assumed. For each resource the new job needs, the
replan is run again with one more unit of it, and the artefact records which of
them - if any - would have avoided the statutory loss.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from engine.core.corridor import blackout_days
from engine.core.schema import SLOTS_DAY, Criticality, Line, Plan
from engine.core.synthetic import build_instance
from engine.export.plan_json import _blocks, _hhmm
from engine.models.pricing import price_instance
from engine.replan import Disruption, diff, replan, usfd_flaw
from engine.solver.model import solve

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

#  The scenario. Wednesday 06:00 falls after Wednesday's night blocks and before
#  its mid-day ones; Thursday is a blackout day, so a 24-hour deadline is
#  genuinely tight rather than tight by construction.
AT_SLOT = 2 * SLOTS_DAY + 6 * 4
SECTION = "SEC-02"
LINE = Line.UP
DUE_WITHIN = SLOTS_DAY


def at(slot: int) -> str:
    return f"{DAYS[(slot // SLOTS_DAY) % 7]} {_hhmm(slot)}"


def _lost(approved: Plan, replanned: Plan) -> list[str]:
    after = {t.tid: t for t in replanned.tasks}
    return sorted(
        t.tid for t in approved.tasks
        if t.criticality is Criticality.A and t.scheduled
        and not after[t.tid].scheduled
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the replan artefact")
    ap.add_argument("--plan", default="web/public/data/plan.json")
    ap.add_argument("--out", default="web/public/data/replan.json")
    ap.add_argument("--time", type=float, default=90.0)
    args = ap.parse_args()
    started = time.perf_counter()

    shipped = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    seed = shipped["provenance"]["seed"]
    n = len(shipped["optimised"]["tasks"])
    inst = price_instance(build_instance(n, seed=seed))
    approved = solve(inst, time_limit_s=args.time, deterministic=True)

    want_obj = shipped["solver"]["objective"]
    want_blocks = len(shipped["optimised"]["blocks"])
    if approved.stats.objective != want_obj or len(approved.blocks) != want_blocks:
        raise SystemExit(
            f"rebuilt plan is not the shipped plan (objective "
            f"{approved.stats.objective} vs {want_obj}, blocks "
            f"{len(approved.blocks)} vs {want_blocks}) - refusing to replan a "
            f"different week"
        )
    print(f"approved plan reproduced: objective {want_obj:,}, {want_blocks} blocks")

    d = Disruption(
        at_slot=AT_SLOT, section=SECTION, line=LINE, due_within_slots=DUE_WITHIN,
        label="Ultrasonic flaw detection finds a rail flaw that must be removed",
    )
    urgent = usfd_flaw(inst, d)
    r = replan(inst, approved, urgent, AT_SLOT, time_limit_s=args.time)
    if r.plan.stats.status not in ("OPTIMAL", "FEASIBLE"):
        raise SystemExit(f"replan returned {r.plan.stats.status}")
    dd = diff(approved, r.plan, AT_SLOT)
    lost = _lost(approved, r.plan)
    print(f"replan: {r.plan.stats.status}, statutory kept {r.statutory_kept}, "
          f"least disruption {r.min_changes}, lost {lost or 'none'}")

    #  One more unit of each resource the job needs - which, if any, avoids it?
    counterfactuals = []
    for res in sorted(urgent.resources):
        bumped = {**inst["resources"], res: inst["resources"][res] + 1}
        more = {**inst, "resources": bumped}
        rc = replan(more, approved, urgent, AT_SLOT, time_limit_s=args.time)
        lc = _lost(approved, rc.plan)
        counterfactuals.append({
            "resource": res,
            "from": inst["resources"][res],
            "to": inst["resources"][res] + 1,
            "statutoryKept": rc.statutory_kept,
            "minChanges": rc.min_changes,
            "lost": lc,
            "avoidsTheLoss": len(lc) < len(lost),
        })
        print(f"  +1 {res}: statutory {rc.statutory_kept}, changes {rc.min_changes}, "
              f"lost {lc or 'none'}")

    by_tid = {t.tid: t for t in inst["tasks"]}
    blackout = sorted(blackout_days())

    def why(tid: str) -> dict[str, Any]:
        t = by_tid[tid]
        between = range(AT_SLOT // SLOTS_DAY, t.due_slot // SLOTS_DAY + 1)
        wins = [
            w for w in inst["windows"]
            if w.section == t.section and AT_SLOT <= w.start < t.due_slot
        ]
        return {
            "tid": tid,
            "activity": t.activity,
            "section": t.section,
            "dueSlot": t.due_slot,
            "dueLabel": at(t.due_slot),
            "windowsBeforeDue": len(wins),
            #  The days those windows fall on - stated from the windows, so the
            #  page never has to assume which day they are.
            "windowDays": [DAYS[x] for x in sorted({w.day for w in wins})],
            "blackoutDaysBeforeDue": [DAYS[x] for x in blackout if x in between],
        }

    inst_all = {**inst, "tasks": [*inst["tasks"], urgent]}
    u = dd["urgent"]
    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "approved": {"objective": want_obj, "seed": seed, "blocks": want_blocks},
        "disruption": {
            "atSlot": AT_SLOT,
            "atLabel": at(AT_SLOT),
            "section": SECTION,
            "line": LINE.value,
            "activity": urgent.activity,
            "dueSlot": urgent.due_slot,
            "dueLabel": at(urgent.due_slot),
            "bookedSlots": urgent.booked,
            "resources": urgent.resources,
            "description": d.label,
            "hoursToDue": (urgent.due_slot - AT_SLOT) * 1440 // SLOTS_DAY // 60,
            #  Days between the disruption and the deadline on which a block is
            #  permitted at all - what "the only day it can be done" rests on.
            "workableDays": [
                DAYS[x % 7]
                for x in range(AT_SLOT // SLOTS_DAY, urgent.due_slot // SLOTS_DAY + 1)
                if x % 7 not in blackout
                and x * SLOTS_DAY < urgent.due_slot
            ],
        },
        "urgent": {
            **u,
            "startLabel": None if u["start"] is None else at(u["start"]),
            "endLabel": None if u["end"] is None else at(u["end"]),
        },
        "result": {
            "status": r.plan.stats.status,
            "statutoryKept": r.statutory_kept,
            "statutoryProven": r.statutory_proven,
            "minChanges": r.min_changes,
            "minChangesProven": r.min_changes_proven,
            "frozenBlocks": r.frozen,
            "wallTimeS": round(time.perf_counter() - started, 1),
        },
        "diff": dd,
        "lost": [why(t) for t in lost],
        "counterfactuals": counterfactuals,
        "blackoutDays": [DAYS[x] for x in blackout],
        "replannedBlocks": _blocks(r.plan, inst_all),
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB) "
          f"in {time.perf_counter() - started:.0f}s")


if __name__ == "__main__":
    main()
