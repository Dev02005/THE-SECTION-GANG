"""
The reference corridor's stations, and the geometry derived from them.

REAL DATA, and the only real data the engine holds. Coordinates are from
DataMeet's `railways` station master, which is CC0 (public domain):

    https://github.com/datameet/railways   -   retrieved 2026-09-06

Every chainage in this module is COMPUTED from those coordinates by
`haversine`, not typed in. That distinction is the point: the previous version
of this corridor carried invented section boundaries (0 / 18.5 / 41.0 / 62.5 /
78.0 km) in two different files, and the two files had to agree by hand. The
real line is 55 km, not 78, so the old numbers were wrong as well as
duplicated.

What this is NOT: a route distance. A great-circle hop between two station
coordinates under-reads the track, which curves where the great circle does
not. We report what we actually computed rather than multiplying by a route
factor we would have had to invent - the whole reason this module exists is to
stop inventing geometry.

The maintenance backlog laid over these sections remains synthetic and
declared; see docs/LIMITATIONS.md.
"""

from __future__ import annotations

import math
from itertools import pairwise
from typing import NamedTuple


class Station(NamedTuple):
    code: str
    name: str
    lat: float
    lon: float


#  The five stations of the reference corridor, in order, on the Waltair
#  division of East Coast Railway.  Each resolves in the CC0 dataset - checked
#  rather than assumed, since the corridor was named from railway knowledge
#  before we held any real data.
CORRIDOR: tuple[Station, ...] = (
    Station("DVD", "Duvvada", 17.7038, 83.1521),
    Station("KTV", "Kottavalasa", 17.8924, 83.1851),
    Station("KPL", "Kantakapalle", 17.9547, 83.2082),
    Station("ALM", "Alamanda", 18.0125, 83.2716),
    Station("VZM", "Vizianagram Jn", 18.1114, 83.3956),
)


def haversine(a: Station, b: Station) -> float:
    """Great-circle distance in km between two stations."""
    radius = 6371.0
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp = p2 - p1
    dl = math.radians(b.lon - a.lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


def chainages() -> tuple[float, ...]:
    """
    Cumulative km from the first station, computed from the coordinates.

    Cumulative along consecutive hops rather than straight from the origin: a
    corridor is a path, and summing the hops tracks it more closely than one
    great circle from end to end.
    """
    out = [0.0]
    for prev, nxt in pairwise(CORRIDOR):
        out.append(out[-1] + haversine(prev, nxt))
    return tuple(round(k, 1) for k in out)


#  Section boundaries, derived.  These are the numbers that used to be invented.
CHAINAGE: tuple[float, ...] = chainages()

#  Total corridor length, derived.  Was asserted as 78.0 km; it is not.
CORRIDOR_KM: float = CHAINAGE[-1]
