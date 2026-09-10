"""
Failure hazard model - prices asset risk.

This converts asset condition into a PRICE: the per-slot cost of leaving a
defect open.  It is what makes a rail flaw, a sticky point machine and a worn
contact wire directly comparable in one objective.

This is the single most important modelling decision in the system.  We do not
RANK maintenance tasks; we PRICE them, in the same unit as train detention.

    E[loss over d days] = C * (1 - e^-Ld)  ~=  C * L * d
    rho = ceil(C * L / slots_per_day * SCALE)

Backend
-------
  sklearn discrete-time hazard. Person-period expansion with a logistic link -
  a legitimate discrete-time survival model, not an approximation of one.

This docstring used to describe an xgboost `survival:cox` backend as
"preferred", with the sklearn model as a fallback. THAT BRANCH WAS NEVER
WRITTEN: `train()` below builds the sklearn pipeline and nothing else, there is
no `import xgboost` anywhere in the engine, and the shipped card reads
`sklearn-discrete`. A C-index of 0.809 quoted in the project notes came from a
trial that never became code; the model that ships scores 0.690.

Corrected rather than deleted, because a stack claim nobody built is the exact
failure catalogued from Sample base 1 - and it was about to go on a slide.

`scikit-survival` was evaluated and rejected for a different reason: its `ecos`
dependency has no Python 3.14 wheel and will not compile here.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from random import Random
from typing import Any

import numpy as np

from engine.models import features as F
from engine.models.registry import ModelCard, new_version, train_and_gate

NAME = "hazard"
PERIOD_DAYS = 7
MAX_PERIODS = 26

ASSET_TYPES = [
    "RAIL", "WELD", "TURNOUT", "POINT_MACHINE", "TRACK_CIRCUIT",
    "SIGNAL", "CABLE", "OHE_SPAN", "INSULATOR", "NEUTRAL_SECTION",
]

#  Consequence of failure in DETENTION-MINUTES.
#
#  This is a POLICY input agreed with the division from historical incident
#  records.  It is NOT learned, and it is published here so it can be argued
#  with.  This table is where railway judgment enters the system; burying it
#  inside model weights would be wrong.
CONSEQUENCE_MINUTES: dict[str, int] = {
    "RAIL": 900, "WELD": 700, "TURNOUT": 500, "SEJ": 700,
    "POINT_MACHINE": 650, "TRACK_CIRCUIT": 800, "SIGNAL": 200,
    "CABLE": 350, "INTERLOCKING": 500, "OHE_SPAN": 850,
    "INSULATOR": 300, "NEUTRAL_SECTION": 700, "MAST": 250,
    "BRIDGE": 400, "LEVEL_CROSSING": 180,
}

_BASE_HAZARD = {
    "RAIL": 0.055, "WELD": 0.038, "TURNOUT": 0.022, "POINT_MACHINE": 0.045,
    "TRACK_CIRCUIT": 0.060, "SIGNAL": 0.014, "CABLE": 0.020,
    "OHE_SPAN": 0.050, "INSULATOR": 0.018, "NEUTRAL_SECTION": 0.040,
}

#  Assets with no failure history fall back to a hazard derived from the
#  schedule interval.  Tasks priced this way are FLAGGED, so the planner sees
#  "schedule-driven" rather than "condition-driven".  Hiding that would be
#  dishonest.
SCHEDULE_INTERVAL_DAYS = {
    "BRIDGE": 365, "LEVEL_CROSSING": 180, "MAST": 365,
    "SEJ": 90, "INTERLOCKING": 180,
}


def schedule_hazard(asset_type: str, overdue_days: float) -> float:
    interval = SCHEDULE_INTERVAL_DAYS.get(asset_type, 180)
    return min(0.5, 0.5 * (1.0 - math.exp(-max(0.0, overdue_days) / interval)))


def synth_assets(n: int = 1500, seed: int = 5):
    """
    Person-period survival data: each asset observed weekly until it fails or
    is censored.  The generative hazard rises with overdue days, prior defect
    count and condition degradation - the effects the model must recover.
    """
    rng = Random(seed)
    rows: list[dict[str, float]] = []
    events: list[int] = []
    a_risk: list[float] = []
    a_time: list[int] = []
    a_event: list[int] = []

    for _ in range(n):
        atype = rng.choice(ASSET_TYPES)
        base = _BASE_HAZARD[atype]
        age = rng.uniform(0.5, 30.0)
        gmt = rng.uniform(5.0, 60.0)
        prior = rng.randrange(0, 7)
        overdue0 = max(0, int(rng.gauss(20, 30)))
        condition = rng.uniform(0.0, 1.0)

        lp = (
            math.log(base)
            + 0.020 * (age / 5.0)
            + 0.015 * (gmt / 10.0)
            + 0.110 * prior
            + 1.300 * condition
        )

        failed, t_fail = 0, MAX_PERIODS
        for p in range(MAX_PERIODS):
            overdue = overdue0 + p * PERIOD_DAYS
            h = min(1.0 / (1.0 + math.exp(-(lp + 0.0060 * overdue))), 0.6)
            feat = {
                "age_years": age,
                "gmt": gmt,
                "prior_defects": float(prior),
                "overdue_days": float(overdue),
                "condition": condition,
                "period": float(p),
            }
            feat.update(F.one_hot(atype, ASSET_TYPES, "at"))
            rows.append(feat)
            if rng.random() < h:
                events.append(1)
                failed, t_fail = 1, p
                break
            events.append(0)

        a_risk.append(lp + 0.0060 * overdue0)
        a_time.append(t_fail)
        a_event.append(failed)

    return rows, events, (a_risk, a_time, a_event)


def concordance(risk: list[float], time: list[int], event: list[int]) -> float:
    """Harrell's C on comparable pairs. Higher risk should fail sooner."""
    r, t, e = np.asarray(risk), np.asarray(time), np.asarray(event)
    conc = perm = 0
    for i in range(0, len(r), max(1, len(r) // 400)):
        if not e[i]:
            continue
        mask = t > t[i]
        perm += int(mask.sum())
        conc += int((r[i] > r[mask]).sum())
    return conc / perm if perm else 0.5


class HazardModel:
    """Serving side. `risk_rates` produces rho_t, what the optimiser consumes."""

    def __init__(self, columns: list[str], model: Any, backend: str) -> None:
        self.columns = columns
        self.model = model
        self.backend = backend
        self.period_days = PERIOD_DAYS

    def daily_hazard(self, rows: list[dict[str, float]]) -> np.ndarray:
        x, _ = F.to_matrix(rows, self.columns)
        p = np.clip(np.asarray(self.model.predict_proba(x)[:, 1], dtype=float), 1e-6, 0.6)
        return 1.0 - (1.0 - p) ** (1.0 / self.period_days)  # period -> daily

    def risk_rates(
        self,
        rows: list[dict[str, float]],
        asset_types: list[str],
        overdue_days: list[float] | None = None,
        slots_per_day: int = 96,
        scale: int = 1000,
    ) -> tuple[list[int], list[bool]]:
        """Returns (rho per task, schedule_driven flag per task)."""
        lam = self.daily_hazard(rows)
        out: list[int] = []
        cold: list[bool] = []
        for i, at in enumerate(asset_types):
            known = at in ASSET_TYPES
            cold.append(not known)
            rate = (
                float(lam[i])
                if known
                else schedule_hazard(at, (overdue_days or [0.0] * len(rows))[i])
            )
            c = CONSEQUENCE_MINUTES.get(at, 300)
            out.append(max(1, math.ceil(c * rate / slots_per_day * scale)))
        return out, cold


def train(rows, events, holdout, seed: int = 0) -> tuple[HazardModel, dict[str, float]]:
    x, cols = F.to_matrix(rows)
    y = np.asarray(events, dtype=int)
    tr, _, te = F.split_indices(len(y), test_frac=0.25, seed=seed)

    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000)).fit(
        x[tr], y[tr]
    )

    p = model.predict_proba(x[te])[:, 1]
    brier = float(np.mean((p - y[te]) ** 2))
    base = float(np.mean(y[tr]))
    brier_base = float(np.mean((base - y[te]) ** 2))
    risk, time, event = holdout
    metrics = {
        "brier": brier,
        "brier_baseline": brier_base,
        "brier_skill": 1.0 - brier / max(1e-9, brier_base),
        "concordance": concordance(risk, time, event),
        "event_rate": base,
    }
    return HazardModel(cols, model, "sklearn-discrete"), metrics


def gate(metrics: dict[str, float]) -> str | None:
    if metrics.get("brier_skill", -1.0) <= 0.0:
        return "no Brier skill over the base rate"
    c = metrics.get("concordance", 0.0)
    if c < 0.60:
        return f"concordance {c:.3f} below 0.60 - not usable for prioritisation"
    if c > 0.95:
        return f"concordance {c:.3f} implausibly high - check for leakage"
    return None


def train_and_register(n_assets: int = 1500, seed: int = 5) -> ModelCard:
    rows, events, holdout = synth_assets(n_assets, seed)
    model, metrics = train(rows, events, holdout)
    card = ModelCard(
        name=NAME,
        version=new_version(),
        trained_at=datetime.now(UTC).isoformat(),
        rows_trained=len(events),
        backend=model.backend,
        metrics=metrics,
        params={"period_days": PERIOD_DAYS},
    )
    return train_and_gate(NAME, model, card, gate)
