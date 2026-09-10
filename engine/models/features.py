"""
Shared feature construction, and the point-in-time rule.

THE RULE: when training on an event that happened on date D, every feature must
be the value KNOWN ON DATE D.  Training on values known only afterwards gives
excellent offline metrics and useless field performance, and it fails silently -
there is no error message, just a model that does not work once deployed.

`PointInTimeStore.as_of()` is the only sanctioned way to read features for
training.  Serving and training must build features through the same helpers
here, or the two will drift apart and nobody will notice until the field
numbers disagree with the validation numbers.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import numpy as np

MONSOON_MONTHS = (6, 7, 8, 9)


@dataclass
class PointInTimeStore:
    """Append-only feature store. Writes carry valid_from; reads carry an asof."""

    _rows: dict[tuple[str, str], list[tuple[datetime, Any]]] = field(
        default_factory=dict
    )

    def write(
        self, entity: str, feature: str, valid_from: datetime, value: Any
    ) -> None:
        series = self._rows.setdefault((entity, feature), [])
        series.append((valid_from, value))
        series.sort(key=lambda pair: pair[0])

    def as_of(
        self, entity: str, feature: str, asof: datetime, default: Any = None
    ) -> Any:
        series = self._rows.get((entity, feature))
        if not series:
            return default
        idx = bisect_right([t for t, _ in series], asof)
        return series[idx - 1][1] if idx else default


def time_features(ts: datetime) -> dict[str, float]:
    return {
        "hour": float(ts.hour),
        "weekday": float(ts.weekday()),
        "is_weekend": 1.0 if ts.weekday() >= 5 else 0.0,
        "is_night": 1.0 if (ts.hour < 5 or ts.hour >= 22) else 0.0,
        "month": float(ts.month),
        "is_monsoon": 1.0 if ts.month in MONSOON_MONTHS else 0.0,
    }


def hash_category(value: str, buckets: int = 64) -> float:
    """
    Stable hashing for high-cardinality categoricals (gang id, activity code).
    Deterministic across processes, unlike Python's salted `hash()` - which
    would give a different feature vector on every run.
    """
    h = 0
    for ch in str(value):
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return float(h % buckets)


def one_hot(value: str, vocabulary: list[str], prefix: str) -> dict[str, float]:
    return {f"{prefix}_{v}": (1.0 if value == v else 0.0) for v in vocabulary}


def to_matrix(
    rows: list[dict[str, float]], columns: list[str] | None = None
) -> tuple[np.ndarray, list[str]]:
    """Dict rows -> (matrix, column order). Missing features become 0.0."""
    cols = columns if columns is not None else sorted({k for r in rows for k in r})
    x = np.zeros((len(rows), len(cols)), dtype=float)
    for i, r in enumerate(rows):
        for j, c in enumerate(cols):
            x[i, j] = float(r.get(c, 0.0))
    return x, cols


def split_indices(
    n: int, test_frac: float, calib_frac: float = 0.0, seed: int = 0
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Deterministic train/calibration/test split.

    The calibration fold exists for split-conformal calibration and must be
    disjoint from both train and test, or the coverage guarantee is void.
    """
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)
    n_test = int(n * test_frac)
    n_calib = int(n * calib_frac)
    return idx[n_test + n_calib :], idx[n_test : n_test + n_calib], idx[:n_test]
