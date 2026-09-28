"""
The database's copy of the engine's rules must stay the engine's rules.

`supabase/migrations/0012_plan_checks.sql` re-runs nine pre-approval checks in
SQL, and SQL cannot import Python - so the limits those checks enforce are
written there a second time. A table written twice and kept in step by hand is
the bug this project has met four times (activities, assets, chainages, the
plan reference). These tests are what keep the step: change a limit in the
engine and forget the migration, and they fail.

The SQL itself is exercised on a real Postgres by `web/scripts/check-sql.mjs`
(every rule broken once, and refused). This file guards only what that suite
cannot see: that the numbers it enforces are the engine's numbers.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from engine.core.corridor import Corridor
from engine.core.schema import SLOTS_DAY
from engine.solver.config import (
    CLEAR_SLOTS,
    MAX_BLOCKS_PER_SECTION_DAY,
    MAX_NIGHT_BLOCKS_PER_SECTION_WEEK,
    SETUP_SLOTS,
)

ROOT = Path(__file__).resolve().parent.parent
MIGRATION = ROOT / "supabase" / "migrations" / "0012_plan_checks.sql"


def _sql_rules() -> dict[str, int]:
    """The `k` block between the RULES markers, as name -> value."""
    text = MIGRATION.read_text(encoding="utf-8")
    block = re.search(r"RULES-BEGIN(.*?)RULES-END", text, re.S)
    assert block, "the RULES-BEGIN / RULES-END markers are gone from 0012"
    found = dict(
        (name, int(value))
        for value, name in re.findall(r"(\d+)\s+as\s+(\w+)", block.group(1))
    )
    assert found, "no `<n> as <name>` rules found between the markers"
    return found


def _night() -> tuple[int, int]:
    (lo, hi), = [(a, b) for a, b, night in Corridor.WINDOWS if night]
    return lo, hi


def _day() -> tuple[int, int]:
    (lo, hi), = [(a, b) for a, b, night in Corridor.WINDOWS if not night]
    return lo, hi


ENGINE = {
    "slots_day": SLOTS_DAY,
    "slot_min": 24 * 60 // SLOTS_DAY,
    "setup": SETUP_SLOTS,
    "clear": CLEAR_SLOTS,
    "min_slots": Corridor.MIN_BLOCK_SLOTS,
    "max_slots": Corridor.MAX_BLOCK_SLOTS,
    "per_day": MAX_BLOCKS_PER_SECTION_DAY,
    "nights": MAX_NIGHT_BLOCKS_PER_SECTION_WEEK,
    "night_from": _night()[0],
    "night_to": _night()[1],
    "day_from": _day()[0],
    "day_to": _day()[1],
}


@pytest.mark.parametrize("name", sorted(ENGINE))
def test_the_database_enforces_the_engines_number(name: str) -> None:
    sql = _sql_rules()
    assert name in sql, f"{name} is not restated in 0012 - the database cannot enforce it"
    assert sql[name] == ENGINE[name], (
        f"0012 enforces {name} = {sql[name]}, the engine {ENGINE[name]}: "
        "update the migration, and the database, with the engine"
    )


def test_nothing_restated_that_the_engine_does_not_have() -> None:
    # A limit only in the SQL is a rule nobody chose in the engine.
    assert set(_sql_rules()) == set(ENGINE)


def test_the_corridor_still_has_one_night_and_one_mid_day_window() -> None:
    # The SQL knows two corridors. A third would be a window the database
    # refuses and the solver uses - so this fails first, where it is cheap.
    assert sorted(night for _a, _b, night in Corridor.WINDOWS) == [False, True]
