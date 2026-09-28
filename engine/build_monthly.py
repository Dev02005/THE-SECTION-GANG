"""
Build the monthly artefact.

    python -m engine.build_monthly

Writes web/public/data/monthly.json, beside plan.json and separate from it: the
weekly plan, its fingerprint and the seeded database are left untouched.

Three steps, each a real solve, because a monthly plan that nobody checks
against the week is a wish list:

  1. MONTH  - allocate a month of backlog to weeks (engine.monthly)
  2. WEEK 1 - hand week 1's allocation to the weekly solver, unchanged, and
              record how much of it the minute-level solve actually places
  3. ROLL   - what week 1 could not place rolls forward; weeks 2-4 are
              re-planned with it, as a rolling horizon does

The week-1 fit rate is the measure of how far the coarse monthly model can be
trusted. It is reported, not tuned away.
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from engine.core.candidates import feasible_pair
from engine.core.schema import Criticality, Department
from engine.export.plan_json import NOTICE
from engine.models.pricing import price_instance
from engine.monthly import (
    PACKING_X10,
    WEEK_SLOTS,
    capacity,
    month_instance,
    resource_load,
    solve_month,
    span_slice,
    week_slice,
)
from engine.solver.config import CLEAR_SLOTS, SETUP_SLOTS
from engine.solver.model import solve

HOURS = 4  # slots per hour
FULL = 0.98  # a resource at or above this share of its week is full


def _hours(slots: int) -> float:
    return round(slots / HOURS, 1)


def _one_based(week: int | None) -> int | None:
    return None if week is None else week + 1


def _deferral_reason(t: Any, month: dict[str, Any], load: dict[str, Any],
                     cells: dict[tuple[str, int], tuple[int, int]]) -> str:
    """Why a job is not in the month: no window it fits, no room, or priced out."""
    weeks = month["horizon_slots"] // WEEK_SLOTS
    horizon = month["horizon_slots"]
    mine = [w for w in month["windows"] if w.section == t.section]
    ok = [wk for wk in range(weeks)
          if any(feasible_pair(t, w, horizon, SETUP_SLOTS, CLEAR_SLOTS)
                 for w in mine if w.start // WEEK_SLOTS == wk)]
    if not ok:
        return "no window this month fits it before its due date"
    #  "No room" only if EVERY week it could use had something full. The first
    #  version collected what was full in ANY such week and reported it as
    #  every week - so all 197 deferrals read "no room" while weeks 3 and 4
    #  stood half empty. Most of them were priced out, and now say so.
    binding: set[str] = set()
    for wk in ok:
        here = {r.replace("_", " ").lower() for r in t.resources
                if load[r][wk][1] and load[r][wk][0] / load[r][wk][1] >= FULL}
        used, cap = cells[(t.section, wk)]
        if cap and used / cap >= FULL:
            here.add(f"{t.section} corridor")
        if not here:
            return "priced out: its risk costs less than the corridor time it would need"
        binding |= here
    return "no room: " + ", ".join(sorted(binding)) + " full in every week it could go"


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the monthly artefact")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--work", type=float, default=20.0, help="monthly work budget")
    ap.add_argument("--time", type=float, default=90.0, help="weekly solve limit (s)")
    ap.add_argument("--out", default="web/public/data/monthly.json")
    args = ap.parse_args()
    started = time.perf_counter()

    # ---- 1. month -------------------------------------------------------- #
    month = price_instance(month_instance(args.seed))
    plan = solve_month(month, work_budget=args.work)
    if plan.status not in ("OPTIMAL", "FEASIBLE"):
        raise SystemExit(f"monthly solve returned {plan.status}")
    tasks = month["tasks"]
    weeks = month["horizon_slots"] // WEEK_SLOTS
    cap = capacity(month)
    load = resource_load(month, plan)
    per_week = Counter(w for w in plan.week_of.values() if w is not None)
    print(f"month: {plan.status}, per week {[per_week[w] for w in range(weeks)]}, "
          f"{sum(v is None for v in plan.week_of.values())} deferred, "
          f"{plan.wall_time_s:.0f}s")

    # ---- 2. week 1 to the weekly solver ------------------------------------ #
    w1 = {tid for tid, w in plan.week_of.items() if w == 0}
    wslice = week_slice(month, w1, 0)
    t0 = time.perf_counter()
    week = solve(wslice, time_limit_s=args.time, deterministic=True)
    week_s = time.perf_counter() - t0
    done = {t.tid for t in week.tasks if t.scheduled}
    by = {t.tid: t for t in tasks}
    misses = sorted(w1 - done)
    binding = {s.tid: s.binding_constraint for s in week.shortfall}
    work = sum(by[t].booked for t in done)
    block = sum(b.dur for b in week.blocks)
    print(f"week 1: {len(done)} of {len(w1)} placed in {len(week.blocks)} blocks, "
          f"packing {work / block:.2f}, {week_s:.0f}s")

    # ---- 3. roll forward --------------------------------------------------- #
    #  Work week 1 missed is still owed. Past its due date it is overdue, not
    #  forgiven: it may go in any later week, and the risk price keeps it early.
    overdue = {t for t in misses if by[t].due_slot <= WEEK_SLOTS}
    rolled_month = {
        **month,
        "tasks": [t.model_copy(update={"due_slot": month["horizon_slots"]})
                  if t.tid in overdue else t for t in tasks],
    }
    remaining = {t.tid for t in tasks} - done
    later = span_slice(rolled_month, remaining, 1, weeks - 1)
    replan = solve_month(later, work_budget=args.work)
    rolled = {tid: (None if w is None else w + 1) for tid, w in replan.week_of.items()}
    carried = {t: rolled.get(t) for t in misses}
    print(f"rolled: {len(misses)} carried, weeks 2-4 re-planned ({replan.status})")

    # ---- payload --------------------------------------------------------- #
    cells: dict[tuple[str, int], tuple[int, int]] = {
        (s.sid, wk): (plan.block_slots[(s.sid, wk)], cap.corridor[(s.sid, wk)])
        for s in month["sections"] for wk in range(weeks)
    }
    statutory = [t for t in tasks if t.criticality is Criticality.A]
    stat_w1 = [t for t in week.tasks if t.criticality is Criticality.A]
    cohort0 = [t for t in tasks if month["cohort"][t.tid] == 0]

    def in_week(slots: dict[tuple[str, int], int], wk: int) -> float:
        return _hours(sum(v for (_, w), v in slots.items() if w == wk))

    def use(r: str, wk: int) -> dict[str, float]:
        used, avail = load[r][wk]
        return {"usedHours": _hours(used), "capHours": _hours(avail),
                "pct": round(100 * used / avail) if avail else 0}

    def placed_in(sid: str, wk: int) -> list[Any]:
        return [t for t in tasks if t.section == sid and plan.week_of[t.tid] == wk]

    def week_row(wk: int) -> dict[str, Any]:
        mine = [t for t in tasks if plan.week_of[t.tid] == wk]
        return {
            "week": wk + 1,
            "jobs": len(mine),
            "byDept": {d.value: sum(t.dept is d for t in mine) for d in Department},
            "statutory": sum(t.criticality is Criticality.A for t in mine),
            "blockHours": in_week(plan.block_slots, wk),
            "corridorHours": in_week(cap.corridor, wk),
            "bothRoadsHours": in_week(plan.both_roads, wk),
            "resources": {r: use(r, wk) for r in month["resources"]},
        }

    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "seed": args.seed,
        "provenance": {"synthetic": True, "notice": NOTICE,
                       "pricedBy": month.get("priced_by", [])},
        "calibration": {
            "packing": PACKING_X10 / 10,
            "note": ("Work-hours per block-hour the monthly plan is held to, measured "
                     "from the weekly solver on a full week (1.22). On the lighter "
                     "shipped week it reaches 2.06; planned at that, week 1 was given "
                     "103 jobs and the weekly solver could place 66."),
        },
        "horizon": {"weeks": weeks, "days": 7 * weeks},
        "sections": [{"id": s.sid, "name": s.name} for s in month["sections"]],
        "solver": {
            "status": plan.status, "objective": plan.objective,
            "bound": round(plan.bound) if plan.bound is not None else None,
            "gapPct": (round(100 * (plan.objective - plan.bound) / plan.objective, 2)
                       if plan.objective and plan.bound is not None else None),
            "wallTimeS": round(plan.wall_time_s, 1),
        },
        "totals": {
            "jobs": len(tasks),
            "placed": sum(v is not None for v in plan.week_of.values()),
            "deferred": sum(v is None for v in plan.week_of.values()),
            "statutoryTotal": len(statutory),
            "statutoryPlaced": sum(plan.week_of[t.tid] is not None for t in statutory),
            "shippedWeekBacklog": len(cohort0),
            "shippedWeekInWeek1": sum(plan.week_of[t.tid] == 0 for t in cohort0),
        },
        "weeks": [week_row(wk) for wk in range(weeks)],
        "cells": [
            {"section": s.sid, "week": wk + 1,
             "jobs": len(placed_in(s.sid, wk)),
             "depts": sorted({t.dept.value for t in placed_in(s.sid, wk)}),
             "statutory": sum(t.criticality is Criticality.A
                              for t in placed_in(s.sid, wk)),
             "blockHours": _hours(cells[(s.sid, wk)][0]),
             "corridorHours": _hours(cells[(s.sid, wk)][1])}
            for s in month["sections"] for wk in range(weeks)
        ],
        "deferred": [
            {"id": t.tid, "dept": t.dept.value, "section": t.section,
             "activity": t.activity, "criticality": t.criticality.value,
             "dueDay": t.due_slot // (WEEK_SLOTS // 7) + 1,
             "reason": _deferral_reason(t, month, load, cells)}
            for t in tasks if plan.week_of[t.tid] is None
        ],
        "handoff": {
            "week": 1,
            "allocated": len(w1),
            "scheduled": len(done),
            "blocks": len(week.blocks),
            "statutory": [sum(t.scheduled for t in stat_w1), len(stat_w1)],
            "packing": round(work / block, 2) if block else None,
            "status": week.stats.status,
            "wallTimeS": round(week_s, 1),
            "misses": [
                {"id": t, "criticality": by[t].criticality.value,
                 "activity": by[t].activity, "section": by[t].section,
                 "binding": binding.get(t, "priced out or displaced by costlier work"),
                 #  1-based, like every other week in this payload
                 "rolledToWeek": _one_based(carried[t]),
                 "overdue": t in overdue}
                for t in misses
            ],
        },
        "rolled": {
            "status": replan.status,
            "carried": len(misses),
            "carriedPlaced": sum(v is not None for v in carried.values()),
            "perWeek": [sum(v == wk for v in rolled.values()) for wk in range(1, weeks)],
            "deferred": sum(v is None for v in rolled.values()),
        },
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB) "
          f"in {time.perf_counter() - started:.0f}s")


if __name__ == "__main__":
    main()
