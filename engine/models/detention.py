"""
Detention cost surface - prices capacity.

Predicts the marginal train-detention (minutes) generated per slot of
occupation of a given road of a given section at a given time.  This is what
tells the optimiser when the corridor is GENUINELY cheap as opposed to merely
nominally free - a block at 07:30 and a block at 02:30 both look free in the
corridor and are nothing alike.

Why a graph would be justified
------------------------------
Blocking SEC-02 does not only detain trains in SEC-02.  It backs traffic into
SEC-01 and starves SEC-03.  A per-section regression cannot see that; message
passing over the section adjacency graph can.  That is the honest justification
for a ST-GNN and the one to give if challenged.

Why we ship a GBM anyway
------------------------
The gate below requires beating a naive baseline, and the generator gives the
GBM neighbour features deliberately, so a future GNN comparison would be fair.
A GNN that wins only because the baseline was starved of features has proven
nothing.  An unjustified GNN is worse than a justified GBM, so on a two-day
build we ship the GBM and say so.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from random import Random
from typing import Any

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

from engine.core.corridor import ADJACENCY, SECTIONS
from engine.core.schema import SLOT_MIN, SLOTS_DAY, Line
from engine.models import features as F
from engine.models.registry import ModelCard, new_version, train_and_gate

NAME = "detention"
SECTION_IDS = [s.sid for s in SECTIONS]
ROADS = [ln.value for ln in (Line.UP, Line.DN)]


def path_density(section: str, road: str, ts: datetime, busyness: float) -> float:
    """
    Scheduled path density from the working timetable.  The diurnal shape is
    the honest part and it is what the whole trade-off rests on.
    """
    h = ts.hour + ts.minute / 60.0
    if 2 <= h < 5:
        base = 0.6
    elif 11 <= h < 14:
        base = 1.0
    elif 6 <= h < 10:
        base = 5.5
    elif 17 <= h < 22:
        base = 6.2
    elif 14 <= h < 17:
        base = 2.8
    else:
        base = 1.8
    if ts.weekday() >= 5:
        base *= 0.8
    return base * busyness


def build_features(
    own_density: float,
    neighbour_densities: list[float],
    goods_forecast: float,
    section: str,
    road: str,
    ts: datetime,
) -> dict[str, float]:
    """Single place a detention feature vector is built - training and serving."""
    feat: dict[str, float] = {
        "own_density": own_density,
        "nbr_density_mean": float(np.mean(neighbour_densities))
        if neighbour_densities
        else 0.0,
        "nbr_density_max": max(neighbour_densities) if neighbour_densities else 0.0,
        "goods_forecast": goods_forecast,
        "n_neighbours": float(len(neighbour_densities)),
    }
    feat.update(F.time_features(ts))
    feat.update(F.one_hot(section, SECTION_IDS, "sec"))
    feat.update(F.one_hot(road, ROADS, "road"))
    return feat


def synth_traffic(days: int = 120, seed: int = 3) -> tuple[list[dict], list[float]]:
    """
    Stands in for COA control charts joined to the WTT and the goods forecast.

    The generative process contains a SPILLOVER term: detention in a section
    depends on the path density of its NEIGHBOURS as well as its own.  That is
    the effect a graph model would capture, and the baseline is handed the same
    neighbour features so the comparison stays fair.
    """
    rng = Random(seed)
    busyness = {(s, r): rng.uniform(0.8, 1.4) for s in SECTION_IDS for r in ROADS}
    rows: list[dict] = []
    y: list[float] = []
    t0 = datetime(2026, 1, 1, tzinfo=UTC)

    for d in range(days):
        for slot in range(0, SLOTS_DAY, 2):
            ts = t0 + timedelta(days=d, minutes=slot * SLOT_MIN)
            for sec in SECTION_IDS:
                for road in ROADS:
                    own = path_density(sec, road, ts, busyness[(sec, road)])
                    nbrs = [
                        path_density(n, road, ts, busyness[(n, road)])
                        for n in ADJACENCY[sec]
                    ]
                    goods = max(0.0, rng.gauss(1.2, 0.6)) * (
                        1.6 if 1 <= ts.hour < 5 else 1.0
                    )
                    #  superlinear in own density, with a real neighbour term
                    det = (
                        3.0
                        + 6.4 * own
                        + 0.55 * own**2
                        + 2.6 * (float(np.mean(nbrs)) if nbrs else 0.0)
                        + 3.1 * goods
                    )
                    det *= 1.10 if ts.month in F.MONSOON_MONTHS else 1.0
                    rows.append(build_features(own, nbrs, goods, sec, road, ts))
                    y.append(max(1.0, rng.gauss(det, 0.12 * det + 1.0)))
    return rows, y


class DetentionModel:
    """Serving side. `surface` produces c[(section, road)][slot] for the solver."""

    def __init__(self, columns: list[str], model: Any, backend: str) -> None:
        self.columns = columns
        self.model = model
        self.backend = backend

    def predict(self, rows: list[dict[str, float]]) -> np.ndarray:
        x, _ = F.to_matrix(rows, self.columns)
        return np.maximum(1.0, np.asarray(self.model.predict(x), dtype=float))

    def surface(
        self, horizon_slots: int, start: datetime, seed: int = 3
    ) -> dict[tuple[str, str], list[int]]:
        """
        Build the full cost surface the optimiser consumes.  Integer minutes -
        CP-SAT wants integer coefficients and the detention table is cumulated
        from these.
        """
        rng = Random(seed)
        busyness = {(s, r): rng.uniform(0.8, 1.4) for s in SECTION_IDS for r in ROADS}
        out: dict[tuple[str, str], list[int]] = {}
        for sec in SECTION_IDS:
            for road in ROADS:
                rows = []
                for s in range(horizon_slots):
                    ts = start + timedelta(minutes=s * SLOT_MIN)
                    own = path_density(sec, road, ts, busyness[(sec, road)])
                    nbrs = [
                        path_density(n, road, ts, busyness[(n, road)])
                        for n in ADJACENCY[sec]
                    ]
                    goods = 1.2 * (1.6 if 1 <= ts.hour < 5 else 1.0)
                    rows.append(build_features(own, nbrs, goods, sec, road, ts))
                out[(sec, road)] = [max(1, round(v)) for v in self.predict(rows)]
        return out


def train(rows: list[dict], y: list[float], seed: int = 0):
    x, cols = F.to_matrix(rows)
    yv = np.asarray(y, dtype=float)
    tr, _, te = F.split_indices(len(yv), test_frac=0.25, seed=seed)

    gbm = HistGradientBoostingRegressor(
        max_iter=300, learning_rate=0.08, max_depth=6, random_state=0
    ).fit(x[tr], yv[tr])

    pred = gbm.predict(x[te])
    mae = float(np.mean(np.abs(pred - yv[te])))
    naive = float(np.mean(np.abs(np.mean(yv[tr]) - yv[te])))
    metrics = {
        "mae_gbm": mae,
        "mae_naive": naive,
        "skill_vs_naive": 1.0 - mae / max(1e-9, naive),
        "mean_actual": float(np.mean(yv[te])),
    }
    return DetentionModel(cols, gbm, "sklearn-gbm"), metrics


def gate(metrics: dict[str, float]) -> str | None:
    """A model that cannot beat the training mean is not a model."""
    skill = metrics.get("skill_vs_naive", 0.0)
    if skill < 0.30:
        return f"skill vs naive mean only {skill:.3f} - not usable"
    return None


def train_and_register(days: int = 120, seed: int = 3) -> ModelCard:
    rows, y = synth_traffic(days, seed)
    model, metrics = train(rows, y)
    card = ModelCard(
        name=NAME,
        version=new_version(),
        trained_at=datetime.now(UTC).isoformat(),
        rows_trained=len(y),
        backend=model.backend,
        metrics=metrics,
        params={"slot_min": SLOT_MIN, "graph": "GBM with neighbour features"},
    )
    return train_and_gate(NAME, model, card, gate)
