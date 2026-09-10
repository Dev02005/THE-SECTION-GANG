"""
Where the three models meet the optimiser.

Each model exists to turn something heterogeneous into a number the solver can
compare, and this module is the only place that substitution happens:

    hazard    -> rho_t,  the per-slot cost of deferring a task
    duration  -> p_t,    the booked P90, in slots
    detention -> c[g,l,s], the cost of occupying a road at a moment

That is the whole role of ML in this system, and it should be stated that
plainly.  If the registry has no promoted model, the raw instance passes
through unchanged and `priced_by` records which models were actually applied -
we never silently claim a number came from a model when it did not.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from engine.core.activities import BY_LABEL, Activity
from engine.core.corridor import STATION_KM
from engine.core.schema import SLOT_MIN, Task
from engine.models import duration as dur_model
from engine.models import features as F
from engine.models import hazard as haz_model
from engine.models.registry import current_versions, load

#  Distance from the nearest station drives access time, which dominates short
#  jobs.  Station posts are the section boundaries, taken from corridor policy
#  rather than copied here - this module previously carried its own duplicate
#  of the table, which is the same drift bug that bit us twice before.
_STATION_KM = STATION_KM

def _spec(task: Task) -> Activity:
    """Resolve a task to its activity spec. Unknown labels are a bug, not a case
    to paper over with a default - the vocabulary is closed and shared."""
    spec = BY_LABEL.get(task.activity)
    if spec is None:
        raise KeyError(
            f"activity {task.activity!r} is not in the shared vocabulary; "
            f"add it to engine.core.activities"
        )
    return spec


def _dist_to_station(section: str, km: float) -> float:
    posts = _STATION_KM.get(section)
    return min(abs(km - p) for p in posts) if posts else 3.0


def _try_load(name: str):
    try:
        return load(name)[0]
    except (FileNotFoundError, ModuleNotFoundError):
        return None


def price_instance(
    instance: dict[str, Any],
    when: datetime | None = None,
    clubbed_assumption: bool = True,
) -> dict[str, Any]:
    """
    Replace hardcoded parameters with model output where a promoted model
    exists.  Returns a new instance; the original is not mutated.

    `clubbed_assumption` books durations as if the task will share a block.
    That is deliberate: the optimiser rewards clubbing, so booking solo
    durations would under-estimate exactly the solutions it prefers.
    """
    when = when or datetime(2026, 3, 2, 1, 0, tzinfo=UTC)
    out = dict(instance)
    applied: list[str] = []

    duration_model = _try_load(dur_model.NAME)
    hazard_model = _try_load(haz_model.NAME)
    detention_model = _try_load("detention")

    tasks: list[Task] = list(instance["tasks"])

    if duration_model is not None:
        rows = [
            dur_model.build_features(
                activity=_spec(t).code,
                quantity=1.0,
                dist_station_km=_dist_to_station(t.section, t.km),
                clubbed=clubbed_assumption,
                #  F.hash_category, NOT builtin hash(): the latter is salted
                #  per process, so the same task would land on a different
                #  gang every run and the plan would never reproduce.
                gang=f"GANG-{int(F.hash_category(t.tid, 12)) + 1:02d}",
                section=t.section,
                when=when,
            )
            for t in tasks
        ]
        p90 = duration_model.booked_slots(rows, slot_minutes=SLOT_MIN)
        p50_min = duration_model.predict(rows, 0.5)
        tasks = [
            t.model_copy(
                update={
                    "p90": max(2, p90[i]),
                    "p50": max(1, min(p90[i] - 1, round(p50_min[i] / SLOT_MIN))),
                }
            )
            for i, t in enumerate(tasks)
        ]
        applied.append("duration")

    if hazard_model is not None:
        rows = []
        types: list[str] = []
        for t in tasks:
            atype = _spec(t).asset_type
            types.append(atype)
            overdue = max(0.0, (t.due_slot - instance["horizon_slots"]) / -96.0)
            feat = {
                "age_years": 12.0,
                "gmt": 30.0,
                "prior_defects": 2.0,
                "overdue_days": overdue,
                "condition": min(1.0, t.hazard * 8.0),
                "period": 0.0,
            }
            feat.update(F.one_hot(atype, haz_model.ASSET_TYPES, "at"))
            rows.append(feat)
        lam = hazard_model.daily_hazard(rows)
        tasks = [
            t.model_copy(
                update={
                    "hazard": float(min(0.95, max(1e-6, lam[i]))),
                    "consequence": haz_model.CONSEQUENCE_MINUTES.get(
                        types[i], t.consequence
                    ),
                    "schedule_driven": types[i] not in haz_model.ASSET_TYPES,
                }
            )
            for i, t in enumerate(tasks)
        ]
        applied.append("hazard")

    out["tasks"] = tasks

    if detention_model is not None:
        out["detention"] = detention_model.surface(instance["horizon_slots"], when)
        applied.append("detention")

    out["priced_by"] = applied
    out["model_versions"] = current_versions()
    return out


def train_all() -> dict[str, Any]:
    """Train and gate all three models. Returns the cards for reporting."""
    from engine.models import detention as det_model

    return {
        "hazard": haz_model.train_and_register(),
        "duration": dur_model.train_and_register(),
        "detention": det_model.train_and_register(),
    }
