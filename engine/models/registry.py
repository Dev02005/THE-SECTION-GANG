"""
Model registry with promotion gates.

Every retrain is evaluated against a gate before it replaces the model in
service.  A failing model is still saved - you want to be able to inspect it -
but it is not promoted, and the previous version stays live.  A gate that
cannot fail is decoration, so each one here has a band that a plausibly bad
model would fall outside.

Every plan records the model versions it was produced with, so any plan can be
reproduced months later.

Windows note: `current` is a plain text file containing a version string, NOT a
symlink.  `os.symlink` needs SeCreateSymbolicLinkPrivilege and raises
WinError 1314 for an ordinary user - which is exactly how the reference
implementation dies on this machine.
"""

from __future__ import annotations

import json
import os
import pickle
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

REGISTRY_ROOT = Path(os.environ.get("SIH_MODEL_ROOT", "model_store"))
_POINTER = "current.txt"


class Gate(Protocol):
    """Returns None to pass, or a human-readable reason to fail."""

    def __call__(self, metrics: dict[str, float]) -> str | None: ...


@dataclass
class ModelCard:
    """What was trained, on what, how well, and whether it shipped."""

    name: str
    version: str
    trained_at: str
    rows_trained: int
    backend: str
    metrics: dict[str, float] = field(default_factory=dict)
    params: dict[str, Any] = field(default_factory=dict)
    passed_gate: bool = False
    notes: str = ""


def new_version() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


def _dir(name: str) -> Path:
    d = REGISTRY_ROOT / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def save(name: str, obj: Any, card: ModelCard) -> Path:
    d = _dir(name) / card.version
    d.mkdir(parents=True, exist_ok=True)
    with (d / "model.pkl").open("wb") as f:
        pickle.dump(obj, f)
    (d / "card.json").write_text(json.dumps(asdict(card), indent=2), encoding="utf-8")
    return d


def promote(name: str, version: str) -> None:
    """Point `current` at a version. A text file, deliberately - see module doc."""
    (_dir(name) / _POINTER).write_text(version, encoding="utf-8")


def current_version(name: str) -> str | None:
    p = _dir(name) / _POINTER
    return p.read_text(encoding="utf-8").strip() if p.exists() else None


def load(name: str, version: str = "current") -> tuple[Any, ModelCard]:
    if version == "current":
        resolved = current_version(name)
        if resolved is None:
            raise FileNotFoundError(f"no promoted model for {name!r} in {REGISTRY_ROOT}")
        version = resolved
    d = _dir(name) / version
    if not d.exists():
        raise FileNotFoundError(f"no model {name}@{version} in {REGISTRY_ROOT}")
    with (d / "model.pkl").open("rb") as f:
        obj = pickle.load(f)  # our own artefact, written by save() above
    card = ModelCard(**json.loads((d / "card.json").read_text(encoding="utf-8")))
    return obj, card


def train_and_gate(name: str, obj: Any, card: ModelCard, gate: Gate) -> ModelCard:
    """
    Save always, promote only on a pass.  A failed gate keeps the previous model
    in service and records why - it does not quietly ship a worse one.
    """
    reason = gate(card.metrics)
    card.passed_gate = reason is None
    if reason:
        card.notes = f"GATE FAILED: {reason}"
    save(name, obj, card)
    if card.passed_gate:
        promote(name, card.version)
    return card


def current_versions() -> dict[str, str]:
    """Stamped onto every plan, so any plan can be reproduced later."""
    out: dict[str, str] = {}
    if not REGISTRY_ROOT.exists():
        return out
    for d in REGISTRY_ROOT.iterdir():
        if d.is_dir():
            v = current_version(d.name)
            if v:
                out[d.name] = v
    return out
