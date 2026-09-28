"""
Build the replan artefact: eight disruptions, each re-solved.

    python -m engine.build_replan

Writes web/public/data/replan.json, beside plan.json and separate from it: the
approved plan, its fingerprint and the seeded database are left untouched, and
nothing has to be re-run in Supabase.

It REFUSES to write if the plan it rebuilds is not the plan that shipped. A
replan is of a specific week; rebuilding a subtly different one and replanning
that would be the manufactured-result failure in its purest form. The check is
the objective and the block count, both of which the deterministic solve
reproduces exactly.

Eight disruptions, not one, so a judge can pick: three kinds of emergency -
a rail flaw (gang and USFD), an S&T failure (S&T crew), an OHE fault (the one
tower wagon) - on different sections, days and deadlines. Each is solved by the
same replanner; none is tuned. A disruption that cannot be dealt with by its
deadline is kept, and says so - with which extra resource would have made it
possible, found by re-solving, as for every scenario.
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from engine.core.corridor import blackout_days
from engine.core.schema import SLOTS_DAY, Criticality, Line, Plan, Task
from engine.core.synthetic import build_instance
from engine.export.plan_json import _blocks, _hhmm
from engine.models.pricing import price_instance
from engine.replan import USFD_FLAW, Disruption, diff, replan, urgent_job
from engine.solver.model import solve

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
OK = ("OPTIMAL", "FEASIBLE")


@dataclass(frozen=True)
class Scenario:
    id: str
    code: str
    short: str
    section: str
    line: Line
    day: int
    hour: int
    due_hours: int
    label: str


#  The first is the original scenario, unchanged: Wednesday 06:00 falls after
#  Wednesday's night blocks and before its mid-day ones, and Thursday is a
#  blackout day, so its 24-hour deadline is genuinely tight.
SCENARIOS = (
    Scenario("usfd-sec02-wed", USFD_FLAW, "USFD rail flaw", "SEC-02", Line.UP, 2, 6, 24,
             "Ultrasonic flaw detection finds a rail flaw that must be removed"),
    Scenario("usfd-sec04-tue", USFD_FLAW, "USFD rail flaw", "SEC-04", Line.DN, 1, 6, 24,
             "Ultrasonic flaw detection finds a rail flaw that must be removed"),
    Scenario("weld-sec01-fri", "ENG.WELD.DEFECT", "Weld defect", "SEC-01", Line.UP,
             4, 6, 24, "A weld defect is found that must be attended"),
    Scenario("tc-sec03-tue", "SNT.TC.FAULT", "Track circuit fault", "SEC-03", Line.DN,
             1, 18, 12, "A track circuit fails and must be restored"),
    Scenario("pm-sec02-sat", "SNT.PM.OVERHAUL", "Point machine failure", "SEC-02",
             Line.UP, 5, 6, 24, "A point machine fails and must be overhauled"),
    Scenario("ohe-sec01-wed", "TRD.OHE.CONTACT_WIRE", "Contact wire damage", "SEC-01",
             Line.UP, 2, 6, 24, "Contact wire damage is found that must be replaced"),
    Scenario("ns-sec03-mon", "TRD.OHE.NEUTRAL_SECTION", "Neutral section fault", "SEC-03",
             Line.UP, 0, 18, 36, "A neutral section fault must be attended"),
    Scenario("ohe-sec04-fri", "TRD.OHE.CONTACT_WIRE", "Contact wire damage", "SEC-04",
             Line.DN, 4, 18, 48, "Contact wire damage is found that must be replaced"),
)


def at(slot: int) -> str:
    return f"{DAYS[(slot // SLOTS_DAY) % 7]} {_hhmm(slot)}"


def _lost(approved: Plan, replanned: Plan) -> list[str]:
    after = {t.tid: t for t in replanned.tasks}
    return sorted(
        t.tid for t in approved.tasks
        if t.criticality is Criticality.A and t.scheduled
        and not after[t.tid].scheduled
    )


def _why(
    t: Task, inst: dict[str, Any], at_slot: int, blackout: list[int]
) -> dict[str, Any]:
    """Why a statutory job had to give way: the windows it had before its deadline."""
    between = range(at_slot // SLOTS_DAY, t.due_slot // SLOTS_DAY + 1)
    wins = [w for w in inst["windows"]
            if w.section == t.section and at_slot <= w.start < t.due_slot]
    return {
        "tid": t.tid,
        "activity": t.activity,
        "section": t.section,
        "dueSlot": t.due_slot,
        "dueLabel": at(t.due_slot),
        "windowsBeforeDue": len(wins),
        #  stated from the windows, so the page never assumes which days they are
        "windowDays": [DAYS[x] for x in sorted({w.day for w in wins})],
        "blackoutDaysBeforeDue": [DAYS[x] for x in blackout if x in between],
    }


def run(sc: Scenario, inst: dict[str, Any], approved: Plan, time_s: float,
        blackout: list[int]) -> dict[str, Any]:
    started = time.perf_counter()
    at_slot = sc.day * SLOTS_DAY + sc.hour * 4
    d = Disruption(at_slot=at_slot, section=sc.section, line=sc.line,
                   due_within_slots=sc.due_hours * 4, label=sc.label)
    urgent = urgent_job(inst, d, sc.code)
    r = replan(inst, approved, urgent, at_slot, time_limit_s=time_s)
    feasible = r.plan.stats.status in OK
    lost = _lost(approved, r.plan) if feasible else []

    #  One more unit of each resource the job needs - which, if any, helps?
    counterfactuals = []
    for res in sorted(urgent.resources):
        bumped = {**inst["resources"], res: inst["resources"][res] + 1}
        more = {**inst, "resources": bumped}
        rc = replan(more, approved, urgent, at_slot, time_limit_s=time_s)
        ok = rc.plan.stats.status in OK
        lc = _lost(approved, rc.plan) if ok else []
        counterfactuals.append({
            "resource": res,
            "from": inst["resources"][res],
            "to": inst["resources"][res] + 1,
            "feasible": ok,
            "statutoryKept": rc.statutory_kept,
            "minChanges": rc.min_changes,
            "lost": lc,
            #  for a met deadline: loses less; for a missed one: makes it possible
            "avoidsTheLoss": (len(lc) < len(lost)) if feasible else ok,
        })

    inst_all = {**inst, "tasks": [*inst["tasks"], urgent]}
    by_tid = {t.tid: t for t in inst["tasks"]}
    dd = diff(approved, r.plan, at_slot, urgent.tid) if feasible else None
    u: dict[str, Any] = dd["urgent"] if dd else {
        "tid": urgent.tid, "scheduled": False, "window": None, "start": None, "end": None,
    }
    print(f"  {sc.id:16s} {r.plan.stats.status:10s} lost {lost or '-'}  "
          f"changes {r.min_changes}  {time.perf_counter() - started:.0f}s", flush=True)
    return {
        "id": sc.id,
        "title": f"{sc.short} · {sc.section} · {at(at_slot)}",
        "feasible": feasible,
        "disruption": {
            "atSlot": at_slot,
            "atLabel": at(at_slot),
            "section": sc.section,
            "line": sc.line.value,
            "activity": urgent.activity,
            "dueSlot": urgent.due_slot,
            "dueLabel": at(urgent.due_slot),
            "bookedSlots": urgent.booked,
            "resources": urgent.resources,
            "description": sc.label,
            "hoursToDue": sc.due_hours,
            #  days between disruption and deadline on which a block is permitted
            "workableDays": [
                DAYS[x % 7]
                for x in range(at_slot // SLOTS_DAY, urgent.due_slot // SLOTS_DAY + 1)
                if x % 7 not in blackout and x * SLOTS_DAY < urgent.due_slot
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
        "lost": [_why(by_tid[t], inst, at_slot, blackout) for t in lost],
        "counterfactuals": counterfactuals,
        "replannedBlocks": _blocks(r.plan, inst_all) if feasible else [],
    }


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

    blackout = sorted(blackout_days())
    scenarios = [run(sc, inst, approved, args.time, blackout) for sc in SCENARIOS]
    payload: dict[str, Any] = {
        "schemaVersion": 2,
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "approved": {"objective": want_obj, "seed": seed, "blocks": want_blocks},
        "blackoutDays": [DAYS[x] for x in blackout],
        "featured": SCENARIOS[0].id,
        "scenarios": scenarios,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB, {len(scenarios)} scenarios) "
          f"in {time.perf_counter() - started:.0f}s")


if __name__ == "__main__":
    main()
