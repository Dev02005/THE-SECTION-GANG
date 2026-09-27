"""
Synthetic feed generator.

DECLARED SYNTHETIC.  TMS, SMMS, TDMS, COA and BDMS are internal Indian Railways
systems with no external access, so the maintenance backlog here is generated,
not observed.  See docs/LIMITATIONS.md.  The generator, its seed and its target
distributions are published precisely so the numbers can be argued with.

What is calibrated rather than invented:
  * activity durations and resource demands follow RDSO Track Machine Manual
    working norms and typical divisional gang strengths
  * failure hazards are anchored to published defect-rate ranges per asset class
  * the instance's own detention surface is MEASURED from the published
    passenger timetable (see engine/core/traffic.py) - the diurnal shape this
    module used to carry was invented and the data contradicted it.
    NOTE: a model-priced plan, which is what ships, replaces this surface with
    the detention model's, and that one still carries the assumed shape.
    See engine/models/detention.py `path_density` and LIMITATIONS §1b.

What is invented: the specific defects, their chainages and their due dates.
"""

from __future__ import annotations

import random
from typing import Any

from engine.core.activities import ACTIVITIES
from engine.core.candidates import generate_windows
from engine.core.corridor import SECTIONS, division
from engine.core.schema import (
    HORIZON_DAYS,
    HORIZON_SLOTS,
    SLOT_MIN,
    SLOTS_DAY,
    Criticality,
    Department,
    Line,
    Section,
    Task,
)
from engine.core.traffic import TRAFFIC

#  Division-level machine and crew availability.  The single tower wagon is the
#  classic binding constraint and the model finds it without being told.
RESOURCES: dict[str, int] = {
    "TAMPER": 1,
    "USFD": 2,
    "GANG": 3,
    "SNT_CREW": 2,
    "TRD_CREW": 2,
    "TOWER_WAGON": 1,
}

#  P90 / P50 overrun observed per department.  Replaced by the trained duration
#  model once T2 lands; kept here so the engine runs standalone.
_OVERRUN = {Department.ENGG: 1.45, Department.SNT: 1.30, Department.TRD: 1.35}

#  POLICY INPUT, published rather than learned: detention-minutes a single
#  held train incurs when a block sits across its path.  Multiplied by the
#  measured train count to give the cost surface.  Argue with this number -
#  it is exactly the sort of thing a division would revise.
MINUTES_PER_DETAINED_TRAIN: float = 20.0


def detention_surface(
    sections: tuple[Section, ...], horizon_slots: int, rng: random.Random
) -> dict[tuple[str, str], list[int]]:
    """
    cost[(section, road)][slot] = detention-minutes generated per slot of
    occupation at that moment.

    MEASURED, not invented.  Built from `engine.core.traffic.TRAFFIC`, which is
    distilled from the published passenger timetable: 480 directional section
    traversals by 114 trains that stop at two or more of this corridor's
    stations, weighted by train class and spread over the weekdays each train
    actually runs.

    The shape this replaces was a guess, and the data contradicts it.  We had
    priced 06:00-10:00 and 17:00-22:00 as the two expensive peaks; on this
    corridor they are among the QUIETEST hours.  Midnight is the busiest, and
    we had it mid-range.  Only the night corridor survived: 02:00 really is
    quiet.  Nationally the distribution is flatter still - every hour carries
    3.5% to 4.4% of all stops, because Indian Railways runs around the clock.

    What is still a POLICY INPUT, published rather than learned:

      * MINUTES_PER_DETAINED_TRAIN - what one held train costs.
      * The even split across the two roads.  Direction is recoverable from the
        timetable but we do not use it; a double line carries both ways and
        halving is the honest simplification until we model paths.

    What is still MISSING, and declared: goods traffic (absent from a passenger
    timetable, and roughly half of all movements), and trains that pass without
    stopping.  Both mean this is a FLOOR on real traffic.

    `rng` is retained for signature compatibility and deliberately unused: the
    surface is now data, so it carries no jitter at all.  Tasks are generated
    before this call, so the backlog is unchanged by the switch.
    """
    del rng  # measured, not sampled

    surface: dict[tuple[str, str], list[int]] = {}
    n_real = len(TRAFFIC)
    for i, sec in enumerate(sections):
        #  Scale-test divisions run past the four real sections; those reuse a
        #  real profile rather than inventing one, which keeps the benchmark
        #  grounded and deterministic.
        profile = TRAFFIC[i % n_real]
        for road in (Line.UP, Line.DN):
            arr: list[int] = []
            for slot in range(horizon_slots):
                day = (slot // SLOTS_DAY) % 7
                hour = (slot % SLOTS_DAY) * SLOT_MIN // 60
                trains_this_slot = profile[day][hour] * SLOT_MIN / 60.0
                #  Half the traffic to each road of a double line.
                cost = trains_this_slot / 2.0 * MINUTES_PER_DETAINED_TRAIN
                arr.append(max(1, round(cost)))
            surface[(sec.sid, road.value)] = arr
    return surface


def generate_tasks(
    sections: tuple[Section, ...], n: int, rng: random.Random
) -> list[Task]:
    """
    The merged arrears register as the three systems would present it.
    `overdue_days` drives the hazard up exactly as the survival model does - an
    overdue asset is a riskier asset.
    """
    tasks: list[Task] = []
    for i in range(n):
        act = rng.choice(ACTIVITIES)
        dept, label, crit = act.dept, act.label, act.criticality
        p50, res, haz, cons = (
            act.p50_slots, act.resources, act.base_hazard, act.consequence_minutes
        )
        sec = rng.choice(sections)

        overdue_days = max(0, int(rng.gauss(20, 30)))
        hazard = min(0.95, haz * (1.0 + overdue_days / 45.0))

        p50_j = max(2, round(p50 * rng.uniform(0.85, 1.15)))
        p90_j = max(p50_j + 1, round(p50_j * _OVERRUN[dept]))

        if crit is Criticality.A:
            due = rng.randint(3, HORIZON_DAYS) * SLOTS_DAY
        elif crit is Criticality.B:
            due = rng.randint(5, HORIZON_DAYS + 3) * SLOTS_DAY
        else:
            due = (HORIZON_DAYS + rng.randint(2, 14)) * SLOTS_DAY

        #  OHE spans are strung over the section; a span is not owned by one road
        line = (
            Line.BOTH
            if dept is Department.TRD and rng.random() < 0.35
            else rng.choice((Line.UP, Line.DN))
        )

        tasks.append(
            Task(
                tid=f"{dept.value}-{i:03d}",
                dept=dept,
                section=sec.sid,
                line=line,
                km=round(rng.uniform(sec.km_from, sec.km_to), 1),
                activity=label,
                criticality=crit,
                p50=p50_j,
                p90=p90_j,
                due_slot=min(due, HORIZON_SLOTS + 14 * SLOTS_DAY),
                hazard=hazard,
                consequence=cons,
                resources=dict(res),
                needs_power_block=dept is Department.TRD,
                needs_disconnection=(
                    dept is Department.SNT and label != "Signal lamp + LED replacement"
                ),
            )
        )
    return tasks


def build_instance(
    n_tasks: int = 90,
    seed: int = 7,
    horizon_days: int = HORIZON_DAYS,
    start_step_min: int | None = None,
    n_sections: int | None = None,
) -> dict[str, Any]:
    """Assemble everything the solver needs. Deterministic for a given seed."""
    rng = random.Random(seed)
    horizon_slots = horizon_days * SLOTS_DAY
    sections = SECTIONS if n_sections is None else division(n_sections)[0]
    return {
        "sections": sections,
        "tasks": generate_tasks(sections, n_tasks, rng),
        "windows": generate_windows(sections, horizon_days, start_step_min),
        "detention": detention_surface(sections, horizon_slots, rng),
        "resources": dict(RESOURCES),
        "horizon_slots": horizon_slots,
        "seed": seed,
        "synthetic": True,
    }
