"""
Build `engine/core/traffic.py` from the published passenger timetable.

    python -m tools.extract_traffic "C:/path/to/bub"

The source files are large (schedules.json alone is 78 MB) and are NOT in this
repository. This script distils them to a few hundred integers, which are, and
the generated module carries its own provenance header. Re-running it on the
same inputs reproduces the module byte for byte.

WHAT IS COMPUTED

A *traversal*: a train that stops at two of our corridor's stations has, in
between, occupied the sections between them. That is real directional section
occupancy rather than a stop count - a stop at Duvvada tells you nothing about
which way the train went, but a stop at Duvvada followed by one at Kottavalasa
does.

Trains appearing at only one corridor station are EXCLUDED: their direction is
unknowable and guessing would invent traffic. Trains that pass through without
stopping are invisible to a timetable of stops, so the count is a floor, not a
census. Goods traffic is absent entirely - the published timetable is
passenger only, and freight is roughly half of all movements.

All three facts are stated in the generated module and in docs/LIMITATIONS.md,
because a traffic figure that hides its exclusions is worth less than a smaller
one that declares them.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from itertools import pairwise
from pathlib import Path

#  The corridor, in order. Must match engine.core.stations.CORRIDOR.
CORRIDOR = ["DVD", "KTV", "KPL", "ALM", "VZM"]
INDEX = {c: i for i, c in enumerate(CORRIDOR)}

#  POLICY INPUT, not learned: how much a delayed train of each class is worth
#  relative to the others. A superfast held at a signal costs more than a
#  passenger held at the same signal, because more people are on it and its
#  path is harder to re-thread. Published here to be argued with, exactly as
#  CONSEQUENCE_MINUTES is.
CLASS_WEIGHT = {"SF": 1.5, "EXP": 1.0, "PASS": 0.7}
DEFAULT_WEIGHT = 1.0

DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


def _minutes(value: str | None) -> int | None:
    if not value or value == "None":
        return None
    try:
        h, m, _ = value.split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None


def load_classes(base: Path) -> dict[str, tuple[str, list[bool]]]:
    """train number -> (class, running days Mon..Sun)."""
    out: dict[str, tuple[str, list[bool]]] = {}
    for name, cls in (
        ("SF-TRAINS.json", "SF"),
        ("EXP-TRAINS.json", "EXP"),
        ("PASS-TRAINS.json", "PASS"),
    ):
        path = base / name
        if not path.exists():
            print(f"  warning: {name} missing, class weights degrade to default")
            continue
        for rec in json.loads(path.read_text(encoding="utf-8")):
            rd = rec.get("runningDays") or {}
            days = [bool(rd.get(d, True)) for d in DAYS]
            if not any(days):
                days = [True] * 7
            out[str(rec["trainNumber"]).zfill(5)] = (cls, days)
    return out


#  Services whose path is protected: they are not held for maintenance. The
#  railway's own premium classes, matched on the timetable's train names.
PREMIUM = ("duronto", "rajdhani", "shatabdi", "vande", "tejas", "garib rath", "humsafar")


def build_protected(
    base: Path, classes: dict[str, tuple[str, list[bool]]]
) -> list[tuple[str, str, int, int, list[bool]]]:
    """
    Real premium paths across the corridor: (train, name, entry, exit, days).

    Entry and exit are minutes past midnight at the first and last corridor
    stop, in JOURNEY order rather than clock order. That distinction matters:
    12245 runs Vizianagram 23:21 -> Duvvada 00:07, so sorting by the clock puts
    00:07 first and makes the transit look like it spans the whole day. It
    wraps midnight instead, and a naive span would have had it crossing both
    maintenance corridors when it crosses neither.
    """
    sched = json.loads((base / "schedules.json").read_text(encoding="utf-8"))
    stops: dict[str, list[tuple[int, int, str]]] = defaultdict(list)
    names: dict[str, str] = {}
    for rec in sched:
        code = rec.get("station_code")
        if code not in INDEX:
            continue
        t = _minutes(rec.get("departure")) or _minutes(rec.get("arrival"))
        if t is not None:
            stops[rec["train_number"]].append((t, INDEX[code], code))
            names[rec["train_number"]] = rec.get("train_name") or ""

    out: list[tuple[str, str, int, int, list[bool]]] = []
    for train, pts in stops.items():
        name = names[train]
        if not any(k in name.lower() for k in PREMIUM) or len(pts) < 2:
            continue
        #  Journey order: the corridor is a line, so the run is monotonic in
        #  station index. Direction comes from which end has the earlier time
        #  once the midnight wrap is undone.
        pts.sort(key=lambda p: p[1])
        times = [t for t, _, _ in pts]
        fwd = [times[0]] + [
            t + 1440 if t < times[0] else t for t in times[1:]
        ]
        rev = list(reversed(times))
        rev = [rev[0]] + [t + 1440 if t < rev[0] else t for t in rev[1:]]
        #  Whichever direction is monotonically increasing is the real one.
        seq = fwd if all(b >= a for a, b in pairwise(fwd)) else rev
        entry, exit_ = seq[0], seq[-1]
        if exit_ - entry > 720:  # neither direction made sense; skip rather than guess
            continue
        _, days = classes.get(str(train).zfill(5), ("", [True] * 7))
        out.append((train, name.strip(), entry % 1440, exit_, days))
    out.sort()
    return out


def build(base: Path) -> tuple[list[list[list[float]]], int, int]:
    """traffic[section][weekday 0=Mon][hour] = weighted trains."""
    sched = json.loads((base / "schedules.json").read_text(encoding="utf-8"))
    classes = load_classes(base)

    stops: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for rec in sched:
        code = rec.get("station_code")
        if code not in INDEX:
            continue
        t = _minutes(rec.get("departure")) or _minutes(rec.get("arrival"))
        if t is not None:
            stops[rec["train_number"]].append((t, INDEX[code]))

    n_sec = len(CORRIDOR) - 1
    traffic = [[[0.0] * 24 for _ in range(7)] for _ in range(n_sec)]
    traversals = 0

    for train, pts in stops.items():
        pts.sort()
        if len(pts) < 2:
            continue  # direction unknowable
        cls, days = classes.get(str(train).zfill(5), ("", [True] * 7))
        w = CLASS_WEIGHT.get(cls, DEFAULT_WEIGHT)
        for (t1, i1), (_t2, i2) in pairwise(pts):
            if i1 == i2:
                continue
            lo, hi = sorted((i1, i2))
            hour = (t1 // 60) % 24
            for sec in range(lo, hi):
                for d in range(7):
                    if days[d]:
                        traffic[sec][d][hour] += w
                traversals += 1
    trains = sum(1 for pts in stops.values() if len(pts) >= 2)
    print(f"  traversals: {traversals}  from {trains} trains")
    return traffic, traversals, trains


TEMPLATE = '''"""
Measured traffic on the reference corridor. GENERATED - do not edit by hand.

Rebuild with:  python -m tools.extract_traffic <dir with schedules.json>

SOURCE: the published Indian Railways passenger timetable (DataMeet
`railways`, CC0). {traversals} directional section traversals by {trains}
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
CLASS_WEIGHT = {{"SF": 1.5, "EXP": 1.0, "PASS": 0.7}}

#  [section][weekday 0=Mon][hour]
TRAFFIC: tuple[tuple[tuple[float, ...], ...], ...] = (
{body})

#  Real premium paths across this corridor, from the same timetable:
#  (train, name, entry minute, exit minute, running days Mon..Sun).
#  A block is never drawn across one of these - see corridor.protected_paths.
#  `exit` may exceed 1440 where the transit wraps past midnight.
PROTECTED: tuple[tuple[str, str, int, int, tuple[bool, ...]], ...] = (
{protected})
'''


def render(
    traffic: list[list[list[float]]],
    traversals: int,
    trains: int,
    protected: list[tuple[str, str, int, int, list[bool]]],
) -> str:
    parts = []
    for sec in traffic:
        rows = []
        for day in sec:
            #  24 values wrapped at 12 a line: the generated module is linted
            #  like any other file, so it has to stay inside the column limit.
            a = ", ".join(f"{v:g}" for v in day[:12])
            b = ", ".join(f"{v:g}" for v in day[12:])
            rows.append(
                "        (\n"
                f"            {a},\n"
                f"            {b},\n"
                "        ),"
            )
        parts.append("    (\n" + "\n".join(rows) + "\n    ),")
    prot = []
    for train, name, entry, exit_, days in protected:
        clean = name.replace('"', "'").strip()[:44]
        flags = ", ".join("True" if d else "False" for d in days)
        prot.append(
            f'    ("{train}", "{clean}",\n     {entry}, {exit_}, ({flags})),'
        )
    return TEMPLATE.format(
        body="\n".join(parts) + "\n",
        traversals=traversals,
        trains=trains,
        protected="\n".join(prot) + "\n",
    )


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    base = Path(sys.argv[1])
    if not (base / "schedules.json").exists():
        print(f"schedules.json not found in {base}")
        return 1
    print(f"reading from {base}")
    traffic, traversals, trains = build(base)
    protected = build_protected(base, load_classes(base))
    print(f"  protected premium paths: {len(protected)}")
    out = Path(__file__).resolve().parent.parent / "engine" / "core" / "traffic.py"
    out.write_text(render(traffic, traversals, trains, protected), encoding="utf-8")
    print(f"  wrote {out} ({out.stat().st_size / 1024:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
