"""
Candidate window generation and task/window compatibility.

Fixing each candidate's START is the modelling decision that makes the whole
formulation tractable: with the start fixed, the detention cost of running that
window for d slots is a constant array, so the objective term becomes an exact
`AddElement` lookup on duration rather than a nonlinear product of two decision
variables.  Nothing is lost, because corridor policy only permits starts on a
coarse grid anyway.
"""

from __future__ import annotations

from engine.core.corridor import Corridor, blackout_days, protected_paths
from engine.core.schema import (
    SLOT_MIN,
    SLOTS_DAY,
    CandidateWindow,
    Line,
    Scope,
    Section,
    Task,
)


def generate_windows(
    sections: tuple[Section, ...],
    horizon_days: int,
    start_step_min: int | None = None,
) -> list[CandidateWindow]:
    """
    Enumerate every block the corridor policy would permit.

    Two filters are applied here rather than as constraints, because a window
    that is never created cannot be chosen:
      * windows overlapping a protected path
      * windows on a blackout day
    """
    step = start_step_min or Corridor.START_STEP_MIN
    prot = protected_paths(horizon_days)
    blackout = blackout_days()
    windows: list[CandidateWindow] = []

    for sec in sections:
        for day in range(horizon_days):
            if day in blackout:
                continue
            for c_from, c_to, is_night in Corridor.WINDOWS:
                for minute in range(c_from, c_to, step):
                    start = day * SLOTS_DAY + minute // SLOT_MIN
                    max_dur = min(Corridor.MAX_BLOCK_SLOTS, (c_to - minute) // SLOT_MIN)
                    max_dur = _clip_to_protected(start, max_dur, prot)
                    if max_dur < Corridor.MIN_BLOCK_SLOTS:
                        continue
                    for scope in (Scope.UP, Scope.DN, Scope.SECTION):
                        windows.append(
                            CandidateWindow(
                                wid=f"W-{sec.sid}-{day}-{minute:04d}-{scope.value}",
                                section=sec.sid,
                                scope=scope,
                                day=day,
                                start=start,
                                max_dur=max_dur,
                                power_block=True,
                                night=is_night,
                            )
                        )
    return windows


def _clip_to_protected(
    start: int, max_dur: int, prot: tuple[tuple[int, int], ...]
) -> int:
    """
    Shorten a window so it stops before the next protected path.

    This used to DISCARD any window whose maximum extent touched a path, which
    was wrong and only became visible once the paths were real. `max_dur` is a
    cap, not a duration: a window running 01:00-05:00 was thrown away because
    its longest possible block would have crossed a 03:30 train, even though a
    two-hour block inside it is perfectly legal and is exactly what a division
    would take. The invented paths sat at 07:00 and 16:00, outside both
    corridors, so the bug never fired - the measured Duronto path at 03:30
    wiped out every night window in the horizon and exposed it.

    A window that *starts* inside a path is genuinely unusable and returns 0.
    """
    end = start + max_dur
    for p_start, p_end in prot:
        if p_start <= start < p_end:
            return 0
        if start < p_start < end:
            end = p_start
    return max(0, end - start)


def compatible(task: Task, window: CandidateWindow) -> bool:
    """
    May `task` legally be performed inside `window`?

    Same section always.  Beyond that the rule encodes one piece of operating
    reality that the whole clubbing argument rests on:

    OHE work needs traction power off, and the power block is taken over the
    SECTION - both roads go down.  Killing the OHE on one road of a double-line
    section is not done for through work.  So a power-block task can only land
    in a SECTION-scope window.

    Meanwhile a task on the UP road can be performed inside a SECTION window
    too.  That asymmetry *is* the clubbing opportunity: the TRD power block is
    expensive because it pays detention on both roads, so the optimiser learns
    to fill it with P.Way and S&T work at the same location.
    """
    if task.section != window.section:
        return False
    if task.needs_power_block or task.line is Line.BOTH:
        return window.scope is Scope.SECTION and window.power_block
    return window.scope.value in (task.line.value, Scope.SECTION.value)


def feasible_pair(
    task: Task, window: CandidateWindow, horizon: int, setup: int, clear: int
) -> bool:
    """
    Can this task be performed in this window at all?

    Compatibility plus the two things that make an assignment arithmetically
    impossible regardless of what the rest of the plan does:

      * the work cannot physically fit inside the window's policy cap
      * the work cannot finish by the task's due date even if it starts the
        instant protection is complete

    Both are already enforced as constraints (C1, C4), so removing the variable
    is EXACT - it deletes no solution. It exists because the variable count is
    what stops the model building at division scale: on a 10,000-task instance
    it is the difference between four million booleans and something a solver
    will accept.
    """
    if not compatible(task, window):
        return False
    if setup + task.booked + clear > window.max_dur:
        return False
    earliest_end = window.start + setup + task.booked
    deadline = min(task.due_slot, horizon)
    return earliest_end <= deadline


def roads_taken(scope: Scope) -> tuple[Line, ...]:
    """Which roads a block of this scope occupies. SECTION takes both."""
    if scope is Scope.SECTION:
        return (Line.UP, Line.DN)
    return (Line.UP,) if scope is Scope.UP else (Line.DN,)


def detention_table(
    window: CandidateWindow, surface: dict[tuple[str, str], list[int]], scale: int
) -> list[int]:
    """
    tbl[d] = cumulative scaled detention of running `window` for exactly d slots.

    A SECTION window pays for both roads, which is what stops the optimiser
    taking section blocks gratuitously - it has to earn them back by clubbing.
    """
    lines = roads_taken(window.scope)
    table = [0]
    running = 0
    for d in range(window.max_dur):
        slot = window.start + d
        running += sum(surface[(window.section, ln.value)][slot] for ln in lines) * scale
        table.append(running)
    return table
