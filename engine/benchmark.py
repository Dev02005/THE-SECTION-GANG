"""
How far does this scale, measured.

Scale is the one dimension where a rival beats us: the C++ entry schedules
10,000 tasks over 60 days in milliseconds. It buys that by having no department
field in its task struct at all - it does no clubbing, which is the thing
SIH26027 actually asks for. Trading the problem away for speed is not a
comparison we should lose quietly, but nor should we answer it with a claim we
have not measured.

So this runs the same optimiser across a ladder of instance sizes and reports
where it stops being viable. The levers, in the order they cost least:

  * coarsen the candidate start grid (`start_step_min`)
  * drop (task, window) pairs that are arithmetically impossible - already done
    in `feasible_pair`, and worth 91% of the variables at division scale
  * shorten the horizon, or roll it

Deliberately NOT used: decomposition by section. The single tower wagon couples
the sections, and decomposing across a shared resource produces a plan nobody
can execute. A faster wrong answer is not an improvement.

    python -m engine.benchmark
"""

from __future__ import annotations

import argparse
import time
from dataclasses import asdict, dataclass
from typing import Any

from engine.baseline.kpis import compute
from engine.core.candidates import feasible_pair
from engine.core.synthetic import build_instance
from engine.solver.build import build
from engine.solver.config import CLEAR_SLOTS, SETUP_SLOTS
from engine.solver.model import solve
from engine.solver.objective import add_objective


@dataclass(frozen=True)
class BenchmarkRow:
    tasks: int
    sections: int
    horizon_days: int
    start_step_min: int
    windows: int
    assignment_vars: int
    build_time_s: float
    solve_time_s: float
    status: str
    objective: int
    bound: int | None
    gap_pct: float | None
    blocks: int
    scheduled: int
    statutory_done: int
    statutory_total: int
    multidept_pct: float


#  (tasks, sections, horizon days, start grid minutes)
#
#  Sections scale WITH the backlog. Growing the task count against a fixed
#  four-section corridor is not a scale test - it just builds an over-subscribed
#  instance no solver can satisfy, and we measured exactly that: UNKNOWN from
#  250 tasks upward. A real division has more sections and more work.
#
#  The start grid coarsens as the instance grows, which is intended operating
#  practice: corridor policy only permits coarse starts anyway.
#  The top rung is deliberately the size the fastest rival quotes, so the
#  comparison is like-for-like. It takes ~20 minutes: the model BUILDS at
#  10,000 tasks (483s, 372k variables) and the solver still finds nothing.
DEFAULT_LADDER: tuple[tuple[int, int, int, int], ...] = (
    (90, 4, 7, 60),
    (500, 12, 14, 120),
    (1_000, 20, 14, 120),
    (2_500, 40, 30, 120),
    (5_000, 60, 30, 120),
    (10_000, 100, 60, 120),
)


def measure(
    tasks: int,
    n_sections: int,
    horizon_days: int,
    start_step_min: int,
    time_limit_s: float = 90.0,
    seed: int = 7,
) -> BenchmarkRow:
    """
    One rung of the ladder. Build and solve are timed separately.

    A fixed WALL CLOCK, not a deterministic work budget. Reproducibility is the
    right guarantee for a plan we ship; throughput is the right question for a
    scale study, and the question a division actually asks is "what do I get in
    N minutes?" Free search answers that; it is not reproducible and this is
    labelled as a benchmark, not a plan.
    """
    instance = build_instance(
        tasks,
        seed=seed,
        horizon_days=horizon_days,
        start_step_min=start_step_min,
        n_sections=n_sections,
    )
    horizon = instance["horizon_slots"]

    n_vars = sum(
        1
        for t in instance["tasks"]
        for w in instance["windows"]
        if feasible_pair(t, w, horizon, SETUP_SLOTS, CLEAR_SLOTS)
    )

    t0 = time.perf_counter()
    mv = build(instance)
    add_objective(mv, instance, _default_weights())
    build_time = time.perf_counter() - t0

    plan = solve(instance, time_limit_s=time_limit_s, deterministic=False)
    k = compute("bench", plan, instance)

    return BenchmarkRow(
        tasks=tasks,
        sections=len(instance["sections"]),
        horizon_days=horizon_days,
        start_step_min=start_step_min,
        windows=len(instance["windows"]),
        assignment_vars=n_vars,
        build_time_s=round(build_time, 2),
        solve_time_s=plan.stats.wall_time_s,
        status=plan.stats.status,
        objective=plan.stats.objective,
        bound=plan.stats.bound,
        gap_pct=plan.stats.gap_pct,
        blocks=k.blocks,
        scheduled=k.scheduled,
        statutory_done=k.statutory_done,
        statutory_total=k.statutory_total,
        multidept_pct=k.multidept_pct,
    )


def _default_weights():
    from engine.core.schema import PolicyWeights

    return PolicyWeights()


def run(
    ladder: tuple[tuple[int, int, int, int], ...] = DEFAULT_LADDER,
    time_limit_s: float = 90.0,
) -> list[BenchmarkRow]:
    rows: list[BenchmarkRow] = []
    for tasks, secs, days, step in ladder:
        row = measure(tasks, secs, days, step, time_limit_s=time_limit_s)
        rows.append(row)
        print(
            f"  {row.tasks:>7,} tasks  {row.sections:>4} sec  {row.horizon_days:>3}d  "
            f"{row.windows:>6,} win  {row.assignment_vars:>9,} vars  "
            f"build {row.build_time_s:>6.1f}s  solve {row.solve_time_s:>6.1f}s  "
            f"{row.status:<10} gap {row.gap_pct if row.gap_pct is not None else '-'}%",
            flush=True,
        )
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description="Scale benchmark for sih26027")
    ap.add_argument("--max-tasks", type=int, default=10_000)
    ap.add_argument("--seconds", type=float, default=90.0)
    ap.add_argument("--out", default="web/public/data/benchmark.json")
    args = ap.parse_args()

    ladder = tuple(r for r in DEFAULT_LADDER if r[0] <= args.max_tasks)
    print(f"scale ladder: {[r[0] for r in ladder]}\n")
    rows = run(ladder, time_limit_s=args.seconds)

    import json
    from pathlib import Path

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "secondsPerRung": args.seconds,
        "note": (
            "Every row is a real solve of the same model, given the same wall "
            "clock. The question is what a division gets in N minutes, so these "
            "runs use free search and are NOT reproducible - unlike the shipped "
            "plan, which fixes a deterministic work budget instead. The "
            "candidate start grid coarsens as the instance grows, which is "
            "intended operating practice. Section decomposition is deliberately "
            "not used: the single tower wagon couples the sections, and "
            "decomposing across a shared resource produces a plan nobody can "
            "execute."
        ),
        "rows": [asdict(r) for r in rows],
    }
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\n  written: {out}")


if __name__ == "__main__":
    main()
