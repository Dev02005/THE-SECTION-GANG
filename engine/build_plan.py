"""
Build the plan artefact the web app loads.

    python -m engine.build_plan --tasks 90 --time 90

Runs the whole pipeline end to end: instance, model pricing, current-practice
baseline, CP-SAT solve, KPI comparison, JSON export.  This is the command that
produces the demo's load path, so it is deliberately the same code path the API
uses - not a parallel one that could drift.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from engine.baseline.current_practice import plan_current_practice
from engine.baseline.kpis import compare, compute, render_table
from engine.core.synthetic import build_instance
from engine.export.plan_json import build_payload, write
from engine.models.pricing import price_instance
from engine.pareto import sweep
from engine.solver.model import solve
from engine.solver.placement import placement_optimality
from engine.validate import all_passed, check_plan


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the sih26027 plan artefact")
    ap.add_argument("--tasks", type=int, default=90)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--time", type=float, default=90.0, help="solver time limit (s)")
    #  MUST be under web/public/ - that is what Next.js serves and what
    #  lib/loadPlan.ts reads at build time. Writing anywhere else silently
    #  changes nothing the site shows.
    ap.add_argument("--out", default="web/public/data/plan.json")
    ap.add_argument(
        "--no-models",
        action="store_true",
        help="skip model pricing and use the raw instance",
    )
    ap.add_argument(
        "--no-pareto",
        action="store_true",
        help="skip the policy-dial sweep (it costs one solve per point)",
    )
    ap.add_argument(
        "--no-placement",
        action="store_true",
        help="skip the placement-optimality re-solve (it costs a second solve)",
    )
    ap.add_argument(
        "--free-search",
        action="store_true",
        help="non-deterministic portfolio: better objective, not reproducible",
    )
    args = ap.parse_args()

    instance = build_instance(args.tasks, seed=args.seed)
    if not args.no_models:
        instance = price_instance(instance)
    print(
        f"instance: {len(instance['sections'])} sections, "
        f"{len(instance['tasks'])} tasks, {len(instance['windows'])} windows, "
        f"priced by {instance.get('priced_by', ['nothing'])}"
    )

    baseline = plan_current_practice(instance)
    optimised = solve(
        instance, time_limit_s=args.time, deterministic=not args.free_search
    )

    if optimised.stats.status not in ("OPTIMAL", "FEASIBLE"):
        raise SystemExit(f"solver returned {optimised.stats.status}")

    print()
    print(
        render_table(
            compare(
                compute("manual", baseline, instance),
                compute("optimised", optimised, instance),
            )
        )
    )
    s = optimised.stats
    print(
        f"\n  solver {s.status} in {s.wall_time_s}s   objective {s.objective:,}"
        f"   bound {s.bound:,}   gap {s.gap_pct}%"
    )
    print(
        f"  deterministic: {s.deterministic}   "
        f"statutory proven: {optimised.statutory_hard}"
    )
    if optimised.shortfall:
        print(f"\n  STATUTORY SHORTFALL ({len(optimised.shortfall)}):")
        for sf in optimised.shortfall:
            print(
                f"    {sf.tid}  rho={sf.risk_rate}/slot  "
                f"binding: {sf.binding_constraint}"
            )

    placement = None
    if not args.no_placement:
        placement = placement_optimality(instance, optimised, time_limit_s=args.time)
        print(
            f"\n  placement optimality: {placement.objective:,} "
            f"vs proven floor {placement.bound:,}  "
            f"(gap {placement.gap_pct}%, {placement.tasks_pinned} tasks pinned)"
        )

    pareto = None
    if not args.no_pareto:
        pareto = sweep(instance)
        good = [p for p in pareto if p.dominated_by is None]
        print(
            f"\n  pareto sweep: {len(pareto)} points, "
            f"{len(good)} non-dominated"
        )

    payload = build_payload(optimised, baseline, instance, placement, pareto)
    #  The pre-approval checks run on the artefact itself, independently of the
    #  solver. A plan that fails any of them is never written - so no failing
    #  plan can reach the site or the database seed.
    checks = check_plan(payload, instance)
    if not all_passed(checks):
        failed = [f"{c['id']} {c['name']}: {c['failures']}"
                  for c in checks if not c["passed"]]
        raise SystemExit("plan fails its pre-approval checks - not written: "
                         + "; ".join(failed))
    print(f"  pre-approval checks: {len(checks)} of {len(checks)} pass")
    path = write(payload, Path(args.out))
    size_kb = path.stat().st_size / 1024
    print(f"\n  artefact written: {path}  ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
