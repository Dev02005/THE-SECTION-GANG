"""
Measured traffic on the reference corridor. GENERATED - do not edit by hand.

Rebuild with:  python -m tools.extract_traffic <dir with schedules.json>

SOURCE: the published Indian Railways passenger timetable (DataMeet
`railways`, CC0). 480 directional section traversals by 114
trains that stop at two or more of our corridor's stations.

TRAFFIC[section][weekday 0=Mon][hour] = weighted trains, where the weight is
the published CLASS_WEIGHT policy input (superfast 1.5, express 1.0, passenger
0.7) rather than a learned parameter.

THREE EXCLUSIONS, declared rather than buried:

  * Trains stopping at only ONE corridor station are excluded - their
    direction cannot be inferred and guessing would invent traffic.
  * Trains that pass WITHOUT stopping are invisible to a timetable of stops.
  * GOODS traffic is absent entirely; the published timetable is passenger
    only, and freight is roughly half of all movements.

So this is a floor on real traffic, not a census, and the detention surface
built from it is a floor too. That is still a large improvement on the shape it
replaces, which was invented - and which this data contradicts in a way worth
stating precisely. Real traffic here is far FLATTER than the shape we assumed,
and differently ordered:

  * The two passenger peaks we priced most expensive - 06:00-10:00 and
    17:00-22:00 - are among the QUIETEST hours on this corridor.
  * Midnight is the busiest hour, and we had priced it mid-range. Long
    distance trains on the Howrah-Chennai route pass Waltair overnight.
  * Only the night-corridor assumption survives: 02:00 really is quiet.

Nationally the distribution is flatter still - every hour carries between
3.5% and 4.4% of all stops. Indian Railways runs around the clock, and a
diurnal shape borrowed from road traffic does not describe it.
"""

from __future__ import annotations

#  POLICY INPUT, published to be argued with - see tools/extract_traffic.py.
CLASS_WEIGHT = {"SF": 1.5, "EXP": 1.0, "PASS": 0.7}

#  [section][weekday 0=Mon][hour]
TRAFFIC: tuple[tuple[tuple[float, ...], ...], ...] = (
    (
        (
            8, 4, 0, 5.5, 4.5, 2.5, 1, 1, 4.5, 2.5, 1.5, 3,
            4.5, 4.5, 4.5, 2.5, 1, 0, 5, 3, 1.5, 3.5, 3, 0,
        ),
        (
            11, 4, 0, 4, 5.5, 0, 1, 1, 4, 3.5, 1.5, 3.5,
            4.5, 3.5, 6, 2.5, 1, 0, 4, 3, 1.5, 3.5, 4.5, 0,
        ),
        (
            8, 5.5, 0, 2.5, 6, 0, 1, 1, 4.5, 1, 1.5, 2,
            5, 5, 4.5, 2.5, 1, 0, 3, 4.5, 1.5, 3.5, 3, 0,
        ),
        (
            9, 4, 0, 4, 7.5, 1.5, 1, 1, 4, 3.5, 1.5, 3,
            4.5, 3.5, 4.5, 2.5, 1, 0, 4, 4.5, 1.5, 3.5, 4, 0,
        ),
        (
            8, 4, 0, 2.5, 6, 1, 1, 1, 4, 5, 1.5, 3.5,
            3.5, 3.5, 3, 2.5, 1, 0, 3, 4.5, 1.5, 3.5, 3, 0,
        ),
        (
            8, 5.5, 0, 2.5, 6, 0, 1, 1, 4.5, 2.5, 1.5, 3.5,
            4.5, 3.5, 3, 2.5, 1, 0, 4, 4.5, 1.5, 3.5, 3, 0,
        ),
        (
            9.5, 4, 0, 2.5, 7.5, 1.5, 1, 1, 4, 5, 1.5, 2,
            5, 5, 4.5, 2.5, 1, 0, 3, 4.5, 1.5, 3.5, 4.5, 0,
        ),
    ),
    (
        (
            11, 4, 2, 3.2, 5, 5, 0.7, 1, 4.5, 2.5, 3.5, 1,
            5, 8.7, 3.2, 2, 4.5, 2.5, 4, 1.7, 3.5, 5, 3.5, 5,
        ),
        (
            15.5, 4, 2, 3.2, 3.5, 3.5, 2.2, 2.5, 4, 4, 2, 2,
            5.5, 7.7, 4.7, 2, 4.5, 1.5, 4, 1.7, 3.5, 4, 4.5, 6.5,
        ),
        (
            11, 5.5, 2, 3.2, 5, 1, 2.2, 1, 4.5, 2.5, 2, 1,
            4.5, 9.2, 4.7, 2, 4.5, 0, 3, 1.7, 5, 5, 3.5, 5,
        ),
        (
            12, 4, 2, 3.2, 6.5, 4, 2.2, 1, 4, 2.5, 3.5, 2,
            5, 7.7, 3.2, 2, 4.5, 1.5, 4, 1.7, 5, 5, 3.5, 6,
        ),
        (
            11, 4, 2, 3.2, 5, 2, 0.7, 1, 4, 4, 3.5, 2,
            4.5, 7.7, 1.7, 2, 4.5, 1.5, 3, 1.7, 5, 5, 3.5, 5,
        ),
        (
            11, 5.5, 2, 3.2, 5, 1, 2.2, 1, 4.5, 2.5, 3.5, 1,
            5.5, 7.7, 1.7, 2, 4.5, 1.5, 4, 1.7, 5, 4, 4.5, 5,
        ),
        (
            12.5, 4, 2, 3.2, 6.5, 2.5, 2.2, 1, 4, 4, 3.5, 2,
            4.5, 9.2, 3.2, 2, 4.5, 0, 3, 1.7, 5, 5, 3.5, 6.5,
        ),
    ),
    (
        (
            10, 5, 2, 3.2, 3.5, 6.5, 1.7, 0, 4.5, 2.5, 3.5, 1,
            5, 7.7, 4.2, 2, 4.5, 2.5, 5, 0.7, 3.5, 6, 3.5, 2,
        ),
        (
            14.5, 5, 2, 3.2, 3.5, 3.5, 1.7, 3, 5.5, 2.5, 2, 2,
            5.5, 6.7, 5.7, 2, 4.5, 1.5, 5, 0.7, 3.5, 5, 4.5, 2,
        ),
        (
            10, 6.5, 2, 3.2, 5, 1, 1.7, 1.5, 4.5, 2.5, 2, 1,
            4.5, 8.2, 5.7, 2, 4.5, 0, 4, 0.7, 5, 6, 3.5, 2,
        ),
        (
            11, 5, 2, 3.2, 8, 2.5, 1.7, 1.5, 4, 2.5, 3.5, 2,
            5, 6.7, 4.2, 2, 4.5, 1.5, 5, 0.7, 5, 6, 3.5, 2,
        ),
        (
            10, 5, 2, 3.2, 5, 2, 1.7, 0, 5.5, 2.5, 3.5, 2,
            4.5, 6.7, 2.7, 2, 4.5, 1.5, 4, 0.7, 5, 6, 3.5, 2,
        ),
        (
            10, 6.5, 2, 3.2, 5, 1, 1.7, 1.5, 4.5, 2.5, 3.5, 1,
            5.5, 6.7, 2.7, 2, 4.5, 1.5, 5, 0.7, 5, 5, 4.5, 2,
        ),
        (
            11.5, 5, 2, 3.2, 8, 1, 1.7, 1.5, 5.5, 2.5, 3.5, 2,
            4.5, 8.2, 4.2, 2, 4.5, 0, 4, 0.7, 5, 6, 3.5, 2,
        ),
    ),
    (
        (
            13, 4, 1, 5.2, 5, 4, 1.7, 0, 3, 4, 2, 3.5,
            5.5, 5.4, 6, 2, 3.5, 4.5, 3, 0.7, 3.5, 5, 4.5, 2,
        ),
        (
            19, 4, 1, 5.2, 2.5, 2.5, 2.7, 3, 4.5, 3.5, 2, 3,
            6, 4.4, 7.5, 2, 3.5, 3.5, 3, 0.7, 3.5, 4, 5.5, 2,
        ),
        (
            13, 5.5, 1, 5.2, 4, 1, 1.7, 1.5, 3, 4, 2, 2,
            5, 5.9, 7.5, 2, 3.5, 1, 3, 0.7, 5, 5, 4.5, 2,
        ),
        (
            15, 4, 1, 5.2, 5.5, 4, 1.7, 1.5, 3, 3.5, 2, 4.5,
            5.5, 4.4, 6, 2, 3.5, 3.5, 3, 0.7, 5, 5, 4.5, 2,
        ),
        (
            13, 4, 1, 5.2, 5, 1, 1.7, 0, 4.5, 3.5, 2, 4.5,
            5, 4.4, 4.5, 2, 3.5, 2.5, 3, 0.7, 5, 5, 4.5, 2,
        ),
        (
            13, 5.5, 1, 5.2, 4, 1, 1.7, 1.5, 3, 4, 2, 3.5,
            6, 4.4, 4.5, 2, 3.5, 3.5, 3, 0.7, 5, 4, 5.5, 2,
        ),
        (
            16, 4, 1, 5.2, 7, 1, 1.7, 1.5, 4.5, 3.5, 2, 4.5,
            5, 5.9, 6, 2, 3.5, 1, 3, 0.7, 5, 5, 4.5, 2,
        ),
    ),
)

#  Real premium paths across this corridor, from the same timetable:
#  (train, name, entry minute, exit minute, running days Mon..Sun).
#  A block is never drawn across one of these - see corridor.protected_paths.
#  `exit` may exceed 1440 where the transit wraps past midnight.
PROTECTED: tuple[tuple[str, str, int, int, tuple[bool, ...]], ...] = (
    ("08469", "Puri-Bangalore weekly Garib Rath special",
     1290, 1412, (True, True, True, True, True, True, True)),
    ("08470", "Bangalore-Puri Garib Rath Special",
     1310, 1415, (True, True, True, True, True, True, True)),
    ("12245", "HOWRAH - YESVANTPUR AC Duronto Exp",
     1401, 1447, (True, True, True, True, True, True, True)),
    ("12246", "YESVANTPUR - HOWRAH AC Duronto Exp",
     210, 241, (True, True, True, True, True, True, True)),
)
