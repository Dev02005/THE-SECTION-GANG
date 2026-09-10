"""
KPIs and the comparison between current practice and the optimised plan.

Every number here is computed from the two plans and the instance they were
solved on.  Nothing is a constant, and nothing differs between the two sides
except the plan itself - the same detention surface, the same risk prices, the
same booked durations are used to score both.

That last point is not a detail.  A rival submission scores its own plan with
`priority x 0.15` and the baseline with `priority x 0.08`, and reports the
difference as "+500.4 hours saved".  Scoring the two sides with different
constants is how you manufacture a result.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from engine.core.candidates import roads_taken
from engine.core.schema import (
    SCALE,
    SLOT_MIN,
    Criticality,
    Plan,
    Task,
)
from engine.solver.config import DEFER_PENALTY_SLOTS


@dataclass(frozen=True)
class Kpis:
    """One side of the comparison. Lower is better for every field but the last four."""

    label: str
    blocks: int
    block_hours: float
    detention_minutes: int
    detention_per_task: float
    risk_carried: int
    scheduled: int
    deferred: int
    statutory_done: int
    statutory_total: int
    multidept_blocks: int
    multidept_pct: float
    packing: float

    @property
    def statutory_pct(self) -> float:
        return 100.0 * self.statutory_done / max(1, self.statutory_total)


def compute(label: str, plan: Plan, instance: dict[str, Any]) -> Kpis:
    """Score a plan against the instance it was solved on."""
    by_tid: dict[str, Task] = {t.tid: t for t in instance["tasks"]}
    surface = instance["detention"]
    horizon: int = instance["horizon_slots"]

    detention = 0
    for b in plan.blocks:
        for ln in roads_taken(b.scope):
            for s in range(b.start, min(b.start + b.dur, horizon)):
                detention += surface[(b.section, ln.value)][s]

    scheduled = [p for p in plan.tasks if p.scheduled]
    deferred = [p for p in plan.tasks if not p.scheduled]

    statutory = [t for t in by_tid.values() if t.criticality is Criticality.A]
    statutory_done = sum(
        1 for p in scheduled if by_tid[p.tid].criticality is Criticality.A
    )

    block_slots = sum(b.dur for b in plan.blocks)
    work_slots = sum(by_tid[p.tid].booked for p in scheduled)

    #  Residual risk: what we still carry, priced the same way for both plans.
    #  A deferred task is charged as if it waits the full notional deferral.
    deferred_cost = horizon + DEFER_PENALTY_SLOTS
    risk = sum(
        by_tid[p.tid].risk_rate
        * (p.start if p.scheduled and p.start is not None else deferred_cost)
        for p in plan.tasks
    )

    multidept = sum(1 for b in plan.blocks if b.clubbed)

    return Kpis(
        label=label,
        blocks=len(plan.blocks),
        block_hours=round(block_slots * SLOT_MIN / 60.0, 1),
        detention_minutes=detention,
        detention_per_task=round(detention / max(1, len(scheduled)), 1),
        risk_carried=risk // SCALE,
        scheduled=len(scheduled),
        deferred=len(deferred),
        statutory_done=statutory_done,
        statutory_total=len(statutory),
        multidept_blocks=multidept,
        multidept_pct=round(100.0 * multidept / max(1, len(plan.blocks)), 1),
        packing=round(work_slots / max(1, block_slots), 2),
    )


def _delta_pct(before: float, after: float) -> float | None:
    """Signed percentage change. None when the baseline is zero."""
    if before == 0:
        return None
    return round(100.0 * (after - before) / before, 1)


def compare(baseline: Kpis, optimised: Kpis) -> dict[str, Any]:
    """The comparison table. Both sides scored identically."""
    return {
        "baseline": baseline,
        "optimised": optimised,
        "deltas": {
            "blocks_pct": _delta_pct(baseline.blocks, optimised.blocks),
            "block_hours_pct": _delta_pct(baseline.block_hours, optimised.block_hours),
            "detention_pct": _delta_pct(
                baseline.detention_minutes, optimised.detention_minutes
            ),
            "detention_per_task_pct": _delta_pct(
                baseline.detention_per_task, optimised.detention_per_task
            ),
            "risk_carried_pct": _delta_pct(baseline.risk_carried, optimised.risk_carried),
            "throughput_pct": _delta_pct(baseline.scheduled, optimised.scheduled),
            "packing_ratio": round(optimised.packing / max(0.01, baseline.packing), 2),
            "statutory_before": f"{baseline.statutory_done}/{baseline.statutory_total}",
            "statutory_after": f"{optimised.statutory_done}/{optimised.statutory_total}",
        },
    }


def render_table(cmp: dict[str, Any]) -> str:
    """Terminal rendering. The same numbers the UI will show."""
    b: Kpis = cmp["baseline"]
    o: Kpis = cmp["optimised"]
    d = cmp["deltas"]

    def pct(v: float | None) -> str:
        return "   -  " if v is None else f"{v:+6.1f}%"

    rows = [
        ("Blocks granted", f"{b.blocks}", f"{o.blocks}", pct(d["blocks_pct"])),
        ("Block-hours on line", f"{b.block_hours}", f"{o.block_hours}",
         pct(d["block_hours_pct"])),
        ("Train detention (min)", f"{b.detention_minutes:,}",
         f"{o.detention_minutes:,}", pct(d["detention_pct"])),
        ("Detention per task done", f"{b.detention_per_task}",
         f"{o.detention_per_task}", pct(d["detention_per_task_pct"])),
        ("Residual risk carried", f"{b.risk_carried:,}", f"{o.risk_carried:,}",
         pct(d["risk_carried_pct"])),
        ("Tasks completed", f"{b.scheduled}", f"{o.scheduled}",
         pct(d["throughput_pct"])),
        ("Statutory closed", d["statutory_before"], d["statutory_after"], ""),
        ("Multi-department blocks", f"{b.multidept_pct}%", f"{o.multidept_pct}%", ""),
        ("Packing (work-hr/block-hr)", f"{b.packing}", f"{o.packing}",
         f"{d['packing_ratio']}x"),
    ]
    width = 78
    out = [
        "=" * width,
        "  CURRENT PRACTICE  vs  OPTIMISED PLAN",
        "=" * width,
        f"  {'Metric':<28}{'Manual':>14}{'AI plan':>14}{'Change':>16}",
        "  " + "-" * (width - 4),
    ]
    out.extend(f"  {n:<28}{x:>14}{y:>14}{z:>16}" for n, x, y, z in rows)
    out.append("=" * width)
    return "\n".join(out)
