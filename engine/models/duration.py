"""
Block duration model - prices time.

Why quantile regression and not a mean
--------------------------------------
The cost of under-booking (block returned late, trains held, controller
escalates) is nothing like the cost of over-booking (a few idle minutes of line
capacity).  Squared error assumes they are equal.  Pinball loss does not:

    L_a(y, yhat) = a * (y - yhat)        if y >= yhat
                   (1 - a) * (yhat - y)  otherwise

At a = 0.9 an under-prediction is penalised nine times harder, so the fitted
surface is the conditional 90th percentile.  We book P90; we show the planner
P50 as the realistic expectation.

Why conformal calibration - the part that matters
-------------------------------------------------
A gradient-boosted quantile fit is a good CONDITIONAL estimate but its MARGINAL
coverage is not guaranteed.  Split-conformal calibration (Romano et al.) adds
the alpha-quantile of held-out calibration residuals and restores the guarantee
on exchangeable data, with no distributional assumption and no tuning.

That matters operationally.  "90% of blocks return on time" has to be a
property we can defend, not a number we tuned until it looked right.

Validation is COVERAGE, not MAE.  A model that is merely accurate on average is
not admissible, so the gate below rejects it.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from random import Random
from typing import Any

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor

from engine.core.activities import ACTIVITIES as CORE_ACTIVITIES
from engine.core.activities import BY_CODE
from engine.models import features as F
from engine.models.registry import ModelCard, new_version, train_and_gate

NAME = "duration"
QUANTILES = (0.5, 0.9)

#  Durations come from engine.core.activities - the single source of truth.
#  Keeping a private copy here is how the model and the task register drifted
#  apart the first time: the model booked 179-minute P90s into a corridor that
#  allows 150 minutes of work, and the optimiser deferred two thirds of the
#  backlog.  Nothing was wrong in either file; they simply disagreed.
ACTIVITY_CODES = tuple(a.code for a in CORE_ACTIVITIES)

GANGS = tuple(f"GANG-{i:02d}" for i in range(1, 13))
SECTIONS = ("SEC-01", "SEC-02", "SEC-03", "SEC-04")


def build_features(
    activity: str,
    quantity: float,
    dist_station_km: float,
    clubbed: bool,
    gang: str,
    section: str,
    when: datetime,
    machine: bool | None = None,
) -> dict[str, float]:
    """
    The single place a duration feature vector is built.  Training and serving
    both come through here, or the two silently drift apart.
    """
    if machine is None:
        spec = BY_CODE.get(activity)
        machine = bool(spec and spec.machine)
    feat: dict[str, float] = {
        "quantity": float(quantity),
        "dist_station_km": float(dist_station_km),
        "clubbed": 1.0 if clubbed else 0.0,
        "machine_involved": 1.0 if machine else 0.0,
        "activity_hash": F.hash_category(activity),
        "gang_hash": F.hash_category(gang),
        "section_hash": F.hash_category(section),
    }
    feat.update(F.time_features(when))
    feat.update(F.one_hot(activity.split(".")[0], ["ENG", "SNT", "TRD"], "dept"))
    return feat


def synth_history(n: int = 4000, seed: int = 11) -> tuple[list[dict], list[float]]:
    """
    Stands in for six months of BDMS actuals joined to field-app task logs.

    The generative process deliberately contains the effects the model must
    find: a per-gang systematic multiplier, access time from the nearest
    station, a monsoon and night penalty, and - critically - a CLUBBING penalty,
    because work in a shared block contends for the same access path.  If the
    duration model does not know clubbed blocks run longer, it mis-estimates
    exactly the solutions the optimiser prefers.

    Noise is heteroscedastic: long jobs are not merely longer, they are more
    VARIABLE.  That is why a single mean estimate cannot work.
    """
    rng = Random(seed)
    gang_effect = {g: rng.gauss(1.0, 0.13) for g in GANGS}
    rows: list[dict] = []
    y: list[float] = []
    t0 = datetime(2026, 1, 1, tzinfo=UTC)

    for _ in range(n):
        spec = rng.choice(CORE_ACTIVITIES)
        act = spec.code
        #  a nominal single-unit job takes p50_minutes; quantity scales the
        #  variable part while set-up stays fixed
        setup = round(spec.p50_minutes * 0.28)
        per_unit = spec.p50_minutes - setup
        qty = max(0.4, round(rng.lognormvariate(0.0, 0.30), 2))
        gang = rng.choice(GANGS)
        section = rng.choice(SECTIONS)
        dist = round(rng.uniform(0.2, 9.0), 2)
        clubbed = rng.random() < 0.35
        machine = spec.machine
        when = t0 + timedelta(minutes=rng.randrange(0, 200 * 24 * 60))

        mean = setup + per_unit * qty
        mean *= gang_effect[gang]
        mean += 3.2 * dist                                  # access time
        mean *= 1.0 + 0.18 * clubbed                        # contention
        mean *= 1.14 if when.month in F.MONSOON_MONTHS else 1.0
        mean *= 1.09 if (when.hour < 5 or when.hour >= 22) else 1.0
        mean += 14.0 * machine                              # berth and release

        sigma = 0.11 * mean + 4.0                           # heteroscedastic
        rows.append(
            build_features(act, qty, dist, clubbed, gang, section, when, machine)
        )
        y.append(max(6.0, rng.gauss(mean, sigma)))
    return rows, y


def pinball(y_true: np.ndarray, y_pred: np.ndarray, alpha: float) -> float:
    d = y_true - y_pred
    return float(np.mean(np.maximum(alpha * d, (alpha - 1.0) * d)))


def coverage(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Fraction of actuals at or below the prediction. Target ~= alpha."""
    return float(np.mean(y_true <= y_pred))


def conformal_delta(residuals: np.ndarray, alpha: float) -> float:
    """
    Split-conformal quantile calibration.  Adding the alpha-quantile of the
    held-out calibration residuals restores marginal coverage >= alpha on
    exchangeable data - no distributional assumption, no tuning.
    """
    s = np.sort(residuals)
    k = int(np.ceil((len(s) + 1) * alpha)) - 1
    return float(s[min(max(k, 0), len(s) - 1)])


class DurationModel:
    """Serving side. `booked_slots` produces p_t, what the optimiser consumes."""

    def __init__(
        self,
        columns: list[str],
        models: dict[float, Any],
        conformal: dict[float, float],
        backend: str,
    ) -> None:
        self.columns = columns
        self.models = models
        self.conformal = conformal
        self.backend = backend

    def predict(
        self, rows: list[dict[str, float]], quantile: float = 0.9
    ) -> np.ndarray:
        x, _ = F.to_matrix(rows, self.columns)
        raw = np.asarray(self.models[quantile].predict(x), dtype=float)
        return raw + self.conformal.get(quantile, 0.0)

    def booked_slots(
        self, rows: list[dict[str, float]], slot_minutes: int = 15
    ) -> list[int]:
        """P90 minutes -> whole slots, rounded up. This is p_t in the model."""
        return [
            max(1, math.ceil(v / slot_minutes)) for v in self.predict(rows, 0.9)
        ]

    def clubbing_penalty(self, rows: list[dict[str, float]]) -> list[float]:
        """
        Extra minutes a task takes when performed in a shared block.  Surfaced
        in the planner so the cost of clubbing is visible rather than hidden -
        the optimiser rewards clubbing, so a planner should be able to see what
        it costs in time as well as what it saves in detention.
        """
        solo = [dict(r, clubbed=0.0) for r in rows]
        shared = [dict(r, clubbed=1.0) for r in rows]
        return [
            float(b - a)
            for a, b in zip(self.predict(solo), self.predict(shared), strict=True)
        ]


def _fit(x: np.ndarray, y: np.ndarray, alpha: float) -> Any:
    return GradientBoostingRegressor(
        loss="quantile",
        alpha=alpha,
        n_estimators=300,
        learning_rate=0.06,
        max_depth=4,
        subsample=0.9,
        random_state=0,
    ).fit(x, y)


def train(
    rows: list[dict], y: list[float], seed: int = 0
) -> tuple[DurationModel, dict[str, float]]:
    x, cols = F.to_matrix(rows)
    yv = np.asarray(y, dtype=float)
    tr, cal, te = F.split_indices(len(yv), test_frac=0.25, calib_frac=0.15, seed=seed)

    models: dict[float, Any] = {}
    conf: dict[float, float] = {}
    metrics: dict[str, float] = {}

    for a in QUANTILES:
        m = _fit(x[tr], yv[tr], a)
        models[a] = m
        delta = conformal_delta(yv[cal] - np.asarray(m.predict(x[cal])), a)
        conf[a] = delta

        raw_te = np.asarray(m.predict(x[te]), dtype=float)
        pct = int(a * 100)
        metrics[f"coverage_raw_p{pct}"] = coverage(yv[te], raw_te)
        metrics[f"conformal_delta_p{pct}"] = delta
        metrics[f"coverage_p{pct}"] = coverage(yv[te], raw_te + delta)
        metrics[f"pinball_p{pct}"] = pinball(yv[te], raw_te + delta, a)
        metrics[f"mean_pred_p{pct}"] = float(np.mean(raw_te + delta))

    metrics["mean_actual"] = float(np.mean(yv[te]))
    metrics["padding_ratio"] = metrics["mean_pred_p90"] / max(
        1e-6, metrics["mean_pred_p50"]
    )
    return DurationModel(cols, models, conf, "sklearn-gbq"), metrics


def gate(metrics: dict[str, float]) -> str | None:
    """Coverage must be calibrated. Accurate-on-average is not admissible."""
    cov = metrics.get("coverage_p90", 0.0)
    if not 0.86 <= cov <= 0.94:
        return f"P90 coverage {cov:.3f} outside [0.86, 0.94]"
    cov50 = metrics.get("coverage_p50", 0.0)
    if not 0.44 <= cov50 <= 0.56:
        return f"P50 coverage {cov50:.3f} outside [0.44, 0.56]"
    pad = metrics.get("padding_ratio", 99.0)
    if pad > 1.60:
        return f"padding ratio {pad:.2f} too high - over-booking line capacity"
    return None


def train_and_register(rows_n: int = 4000, seed: int = 11) -> ModelCard:
    rows, y = synth_history(rows_n, seed)
    model, metrics = train(rows, y)
    card = ModelCard(
        name=NAME,
        version=new_version(),
        trained_at=datetime.now(UTC).isoformat(),
        rows_trained=len(y),
        backend=model.backend,
        metrics=metrics,
        params={"quantiles": list(QUANTILES)},
    )
    return train_and_gate(NAME, model, card, gate)
