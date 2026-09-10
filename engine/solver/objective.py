"""
The objective, and the clubbing measurement it depends on.

    minimise  aR * SUM rho_t * start_t              risk carried in-horizon
            + aR * SUM rho_t * (T+D) * (1 - z_t)    risk of deferring out
            + aD * SUM tbl_w[dur_w]                 train detention
            + aF * K * SUM granted_w                fixed block overhead
            - aC * B * SUM extra_depts_w            clubbing reward

The last term is the entire point of the system.  It is the only quantity in
the objective that no department can see when it bids for its own block.
"""

from __future__ import annotations

from typing import Any

from engine.core.candidates import detention_table
from engine.core.schema import SCALE, Criticality, Department, PolicyWeights
from engine.solver.build import ModelVars
from engine.solver.config import (
    CLUB_BONUS,
    DEFER_PENALTY_SLOTS,
    FIXED_BLOCK_COST,
    STATUTORY_SOFT_PENALTY,
)


def add_objective(
    mv: ModelVars,
    instance: dict[str, Any],
    w: PolicyWeights,
    hard_statutory: bool = True,
    include_deferral: bool = True,
) -> None:
    """
    Price the model. Mutates `mv.model` and fills `mv.det_cost`.

    `include_deferral=False` drops the out-of-horizon penalty. Only valid when
    the schedule is pinned, where that term is a constant - it is what turns the
    objective into pure placement cost so the reported gap means something a
    planner would recognise.
    """
    m = mv.model
    tasks = instance["tasks"]
    windows = instance["windows"]
    surface = instance["detention"]
    horizon = instance["horizon_slots"]
    granted, dur, ts, sched = mv.granted, mv.dur, mv.ts, mv.sched
    x, by_window, by_tid = mv.x, mv.by_window, mv.by_tid

    # ---- clubbing measurement -------------------------------------------- #
    #  The clubbing reward is the only NEGATIVE term in the objective, so the
    #  linear relaxation will happily pretend every window is fully clubbed and
    #  drive the lower bound to nothing.  Two valid cuts stop that, and they are
    #  what makes the reported optimality gap meaningful rather than cosmetic.
    club_terms = []
    for win in windows:
        tids = by_window[win.wid]
        if not tids:
            continue
        present = []
        for d in Department:
            members = [x[(tid, win.wid)] for tid in tids if by_tid[tid].dept is d]
            if not members:
                continue
            b = m.NewBoolVar(f"dep[{win.wid},{d.value}]")
            m.AddMaxEquality(b, members)
            #  a department cannot be present in a block that was never granted
            m.AddImplication(b, granted[win.wid])
            present.append(b)
        if present:
            extra = m.NewIntVar(0, len(Department) - 1, f"extra[{win.wid}]")
            m.Add(extra == sum(present) - granted[win.wid])
            #  cut 1: no clubbing reward at all from an ungranted window
            m.Add(extra <= (len(Department) - 1) * granted[win.wid])
            club_terms.append(extra)

    #  cut 2 (global): every extra department in a block is an extra task in
    #  that block, so total clubbing cannot exceed (tasks placed) - (blocks
    #  granted).  Tight, valid, and it is what actually lifts the bound.
    if club_terms:
        m.Add(
            sum(club_terms)
            <= sum(sched[t.tid] for t in tasks) - sum(granted[u.wid] for u in windows)
        )

    # ---- objective -------------------------------------------------------- #
    obj: list[Any] = []
    for t in tasks:
        obj.append(int(w.alpha_risk * t.risk_rate) * ts[t.tid])
        if include_deferral:
            pen = int(w.alpha_risk * t.risk_rate * (horizon + DEFER_PENALTY_SLOTS))
            obj.append(pen * (1 - sched[t.tid]))
        if not hard_statutory and t.criticality is Criticality.A:
            obj.append(STATUTORY_SOFT_PENALTY * (1 - sched[t.tid]))

    det_cost = mv.det_cost
    for win in windows:
        tbl = detention_table(win, surface, SCALE)
        c = m.NewIntVar(0, tbl[-1], f"det[{win.wid}]")
        m.AddElement(dur[win.wid], tbl, c)  # exact: the start is fixed
        det_cost[win.wid] = c
        obj.append(int(w.alpha_detention) * c)

    for win in windows:
        obj.append(int(w.alpha_fixed * FIXED_BLOCK_COST) * granted[win.wid])
    for e in club_terms:
        obj.append(-int(w.alpha_club * CLUB_BONUS) * e)

    m.Minimize(sum(obj))

