"""
Corridor policy: the physical division and the rules about when it may be
taken out of use.

Everything here is *policy*, not optimisation.  Windows that violate any of it
are never generated, which is the cheapest possible enforcement - the optimiser
never sees an illegal option, so it cannot pick one and we do not pay for a
constraint to stop it.
"""

from __future__ import annotations

from itertools import pairwise

from engine.core.schema import SLOT_MIN, SLOTS_DAY, Section
from engine.core.stations import CHAINAGE, CORRIDOR
from engine.core.traffic import PROTECTED

#  A double-line electrified stretch on the Waltair division, DERIVED from the
#  real station coordinates in engine.core.stations rather than asserted.
#
#  These boundaries used to be hand-written - 0 / 18.5 / 41.0 / 62.5 / 78.0 -
#  in this file AND again in models/pricing.py, which had to agree by hand.
#  They were also wrong: the line is 55 km, not 78.  Deriving them from
#  published coordinates removes the invention and the duplication at once.
#
#  The maintenance backlog laid over these sections remains synthetic and
#  declared (see docs/LIMITATIONS.md).  Real geometry, generated work.
SECTIONS: tuple[Section, ...] = tuple(
    Section(
        sid=f"SEC-{i + 1:02d}",
        name=f"{a.name} – {b.name}",
        km_from=CHAINAGE[i],
        km_to=CHAINAGE[i + 1],
    )
    for i, (a, b) in enumerate(pairwise(CORRIDOR))
)

#  Section boundaries are station posts: the access-time feature in
#  models/pricing.py measures distance to the nearest of them.  Exported here
#  so there is one source for it rather than a second copy in that module.
STATION_KM: dict[str, tuple[float, float]] = {
    s.sid: (s.km_from, s.km_to) for s in SECTIONS
}

#  Sections are contiguous, so blocking one backs traffic into its neighbours.
#  Used by the detention model; a per-section regression cannot see spillover.
ADJACENCY: dict[str, tuple[str, ...]] = {
    "SEC-01": ("SEC-02",),
    "SEC-02": ("SEC-01", "SEC-03"),
    "SEC-03": ("SEC-02", "SEC-04"),
    "SEC-04": ("SEC-03",),
}


class Corridor:
    """Permitted block windows on this division."""

    #  (start_minute, end_minute, is_night).  Two corridors, as most divisions
    #  run: a mid-day slot and a night slot.
    WINDOWS: tuple[tuple[int, int, bool], ...] = (
        (11 * 60, 15 * 60, False),  # mid-day maintenance corridor
        (1 * 60, 5 * 60, True),     # night corridor
    )

    #  Candidate start granularity.  Coarser => smaller model.  60 is the demo
    #  default; T14 raises this to 120 for the division-scale benchmark.
    START_STEP_MIN: int = 60

    #  A block may use the full width of its corridor - both corridors above are
    #  four hours.  Capping at three was an arbitrary extra restriction that had
    #  the effect of making the longest activities (deep screening, turnout
    #  overhaul) permanently unschedulable once real P90 durations were used.
    MAX_BLOCK_SLOTS: int = 16
    #  Below an hour a block costs more in protection than it buys in work.
    MIN_BLOCK_SLOTS: int = 4


def division(n_sections: int) -> tuple[tuple[Section, ...], dict[str, tuple[str, ...]]]:
    """
    A division of `n_sections` contiguous block sections.

    Scaling the backlog without scaling the corridor is not a scale test - it
    just makes an over-subscribed instance that no solver can satisfy. A real
    division has more sections AND more work, so the benchmark grows both.

    The first four are the named reference sections; beyond that they are
    generated at the same ~20 km spacing.
    """
    if n_sections <= len(SECTIONS):
        secs = SECTIONS[:n_sections]
    else:
        extra = []
        km = SECTIONS[-1].km_to
        for i in range(len(SECTIONS), n_sections):
            extra.append(
                Section(
                    sid=f"SEC-{i + 1:02d}",
                    name=f"Section {i + 1}",
                    km_from=km,
                    km_to=km + 20.0,
                )
            )
            km += 20.0
        secs = SECTIONS + tuple(extra)

    adj: dict[str, tuple[str, ...]] = {}
    for i, sec in enumerate(secs):
        nbrs = []
        if i > 0:
            nbrs.append(secs[i - 1].sid)
        if i < len(secs) - 1:
            nbrs.append(secs[i + 1].sid)
        adj[sec.sid] = tuple(nbrs)
    return secs, adj


def protected_paths(horizon_days: int) -> tuple[tuple[int, int], ...]:
    """
    Premium paths that may not be disturbed, MEASURED from the timetable.

    Returned as absolute slot intervals.  A candidate window overlapping one of
    these is never created, so a block can never be drawn across a protected
    path.  That is a planning error the model is structurally incapable of
    making, rather than one it is penalised for.

    These used to be invented: two paths a day at 07:00 and 16:00, protecting
    nothing that runs.  `traffic.PROTECTED` holds the real ones - four premium
    services across this corridor, with their real transit times and the
    weekdays they actually run.  One of them matters: **12246, the Yesvantpur
    Duronto, crosses the night maintenance corridor at 03:30-04:01**, and the
    invented pair missed it completely.

    Day 0 of the horizon is taken as a Monday, which is also how the detention
    surface indexes weekdays, so the two agree.
    """
    out: list[tuple[int, int]] = []
    for _train, _name, entry, exit_, days in PROTECTED:
        for day in range(horizon_days):
            if not days[day % 7]:
                continue
            base = day * SLOTS_DAY
            #  `exit_` runs past 1440 where the transit wraps midnight; the
            #  slot arithmetic carries it into the next day on its own.
            start = base + entry // SLOT_MIN
            end = base + -(-exit_ // SLOT_MIN)  # ceil, so a part-slot is kept
            out.append((start, end))
    return tuple(sorted(out))


def blackout_days() -> frozenset[int]:
    """
    Days on which no block is permitted at all: festival traffic ban, special
    working, monsoon patrolling intensification.
    """
    return frozenset({3})
