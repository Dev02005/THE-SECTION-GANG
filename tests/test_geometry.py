"""
The corridor geometry is derived from published coordinates, not typed in.

These tests exist because the geometry used to be invented AND duplicated: the
section boundaries 0 / 18.5 / 41.0 / 62.5 / 78.0 were hand-written in
`core/corridor.py` and again in `models/pricing.py`, and the two had to agree
by hand. That is the same drift bug that has already bitten this project twice
- once with the activity duration table, once with the asset table - so it gets
a test rather than a comment.

The old numbers were also simply wrong. The real line is 55 km, not 78.
"""

from __future__ import annotations

import math

from engine.core import stations as S
from engine.core.candidates import generate_windows
from engine.core.corridor import SECTIONS, STATION_KM, protected_paths
from engine.models.pricing import _STATION_KM


def test_chainages_are_computed_from_coordinates() -> None:
    """Recompute independently; the module must not be carrying constants."""
    expected = [0.0]
    for a, b in zip(S.CORRIDOR, S.CORRIDOR[1:], strict=False):
        r = 6371.0
        p1, p2 = math.radians(a.lat), math.radians(b.lat)
        dp = p2 - p1
        dl = math.radians(b.lon - a.lon)
        h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        expected.append(expected[-1] + 2 * r * math.asin(math.sqrt(h)))

    assert tuple(round(k, 1) for k in expected) == S.CHAINAGE


def test_sections_derive_from_the_chainages() -> None:
    """Every boundary must come from the station data, in order."""
    assert len(SECTIONS) == len(S.CORRIDOR) - 1
    for i, sec in enumerate(SECTIONS):
        assert sec.km_from == S.CHAINAGE[i]
        assert sec.km_to == S.CHAINAGE[i + 1]
        assert S.CORRIDOR[i].name in sec.name
        assert S.CORRIDOR[i + 1].name in sec.name


def test_station_km_is_not_a_second_copy() -> None:
    """
    pricing.py must READ the corridor's table, not keep its own.

    This is the assertion that would have caught the original bug: the two
    tables were identical the day they were written and would have drifted the
    first time either was edited.
    """
    assert _STATION_KM is STATION_KM
    assert {s.sid: (s.km_from, s.km_to) for s in SECTIONS} == STATION_KM


def test_corridor_is_the_real_length_not_the_invented_one() -> None:
    """55 km, computed. Not 78, asserted."""
    assert 50.0 < S.CORRIDOR_KM < 60.0
    assert SECTIONS[-1].km_to == S.CORRIDOR_KM
    assert abs(S.CORRIDOR_KM - 78.0) > 20.0


def test_corridor_stations_are_real_and_ordered() -> None:
    """
    Codes are real Indian Railways station codes on the Waltair division, and
    the corridor runs monotonically north-east.
    """
    assert [s.code for s in S.CORRIDOR] == ["DVD", "KTV", "KPL", "ALM", "VZM"]
    for a, b in zip(S.CORRIDOR, S.CORRIDOR[1:], strict=False):
        assert b.lat > a.lat, f"{b.code} should lie north of {a.code}"
        assert b.lon > a.lon, f"{b.code} should lie east of {a.code}"
    #  Andhra Pradesh, near Visakhapatnam - a coordinate typo would show here.
    for s in S.CORRIDOR:
        assert 17.0 < s.lat < 19.0
        assert 82.0 < s.lon < 84.0


# --------------------------------------------------------------------------- #
#  Protected paths, measured                                                    #
# --------------------------------------------------------------------------- #


def test_protected_paths_are_real_services_not_invented_slots() -> None:
    """
    They used to be two made-up paths a day at 07:00 and 16:00, which protected
    nothing that runs. Now they come from the timetable.
    """
    from engine.core.traffic import PROTECTED

    assert len(PROTECTED) >= 2
    for train, name, entry, exit_, days in PROTECTED:
        assert train.isdigit() and len(train) == 5
        assert name
        assert 0 <= entry < 1440
        assert entry < exit_ <= 1440 + 720  # may wrap past midnight
        assert len(days) == 7 and any(days)


def test_a_real_premium_path_crosses_the_night_corridor() -> None:
    """
    12246, the Yesvantpur Duronto, runs 03:30-04:01 - inside the 01:00-05:00
    night corridor. This is the fact the invented paths missed entirely, and
    the reason the night window is shorter than the corridor allows.
    """
    from engine.core.traffic import PROTECTED

    night_start, night_end = 60, 300
    crossing = [
        t for t, _n, a, b, _d in PROTECTED if a < night_end and night_start < b
    ]
    assert "12246" in crossing


def test_windows_are_clipped_by_protected_paths_not_discarded() -> None:
    """
    The bug this guards: `max_dur` is a CAP, not a duration, so a window whose
    longest possible block would cross a path is still usable for a shorter
    block. Discarding it removed every night window in the horizon once the
    paths became real.

    A division facing a 03:30 train takes the block at 01:00 and clears before
    it. That window must exist, and must stop short of the path.
    """
    from engine.core.schema import SLOT_MIN, SLOTS_DAY

    windows = generate_windows(SECTIONS, 7, None)
    night = [w for w in windows if (w.start % SLOTS_DAY) * SLOT_MIN < 6 * 60]
    assert night, "protected paths wiped out the whole night corridor"

    one_am = [
        w for w in night if (w.start % SLOTS_DAY) * SLOT_MIN == 60 and w.day == 0
    ]
    assert one_am, "the 01:00 night window must survive"
    #  01:00 + 150 min = 03:30, exactly where the Duronto enters.
    assert one_am[0].max_dur == 10


def test_no_generated_window_can_overlap_a_protected_path() -> None:
    """Structural: the optimiser must never even see an illegal option."""
    prot = protected_paths(7)
    for w in generate_windows(SECTIONS, 7, None):
        end = w.start + w.max_dur
        for p_start, p_end in prot:
            assert not (w.start < p_end and p_start < end), (
                f"{w.wid} overlaps protected path {p_start}-{p_end}"
            )
