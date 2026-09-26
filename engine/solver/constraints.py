"""
The eleven constraints, named the way a division would say them.

WHY THIS FILE EXISTS

They were called C1 to C11. That is how they are written in the model and it is
how a paper would number them, but it is not how anyone in an operating office
speaks: nobody asks whether "C8" is binding, they ask whether the tower wagon
is free. The shortfall list a DRM carries to the zonal meeting said
"TOWER_WAGON capacity (C8)", which reads like a compiler error.

WHAT THESE NAMES ARE NOT

They are NOT citations of the General and Subsidiary Rules. G&SR is a real
rulebook with real numbering, and we have not checked our constraints against
it, so we do not label them "G&SR-4" and invite a judge who knows the book to
check. Every name below describes what the constraint actually does, in
operating language. The paper identifier is kept alongside, because the tests
and the model comments refer to it and a reader should be able to follow both.

One source. The model comments, the shortfall attribution, the artefact and the
method page all read from here - the drift bug this project has paid for five
times over.
"""

from __future__ import annotations

from typing import NamedTuple


class Constraint(NamedTuple):
    cid: str
    name: str
    detail: str


CONSTRAINTS: tuple[Constraint, ...] = (
    Constraint(
        "C1",
        "Sanctioned window length",
        "A granted block runs at least the minimum the corridor policy allows "
        "and no longer than its window; an ungranted one has zero length.",
    ),
    Constraint(
        "C2",
        "One sanction per work item",
        "Each task is placed in exactly one block, or it is deferred and priced "
        "as deferred. Nothing is half-scheduled.",
    ),
    Constraint(
        "C3",
        "Statutory obligation",
        "Criticality-A work is a hard constraint, solved first. A feasible plan "
        "is therefore a proof that every obligation is met, not a claim that "
        "the penalty was set high enough.",
    ),
    Constraint(
        "C4",
        "Due-date compliance",
        "Statutory and scheduled work finishes on or before the date it is due.",
    ),
    Constraint(
        "C5",
        "No sanction without work",
        "A block is granted only if a task uses it. The line is never closed "
        "for nothing.",
    ),
    Constraint(
        "C6",
        "Protection and clearance",
        "Work starts only after protection is complete and ends before "
        "clearance begins. A block does not start when the gang starts.",
    ),
    Constraint(
        "C7",
        "Line occupation and power-block coupling",
        "No two blocks hold the same road at once, and a section-scope window "
        "enters both roads at once - OHE work takes the section down and pays "
        "detention on both.",
    ),
    Constraint(
        "C8",
        "Machine and gang availability",
        "One tower wagon, one tamper, two USFD units, gangs and crews, shared "
        "across the division. The single tower wagon is the classic binding "
        "constraint, and the model finds it without being told.",
    ),
    Constraint(
        "C9",
        "Blocks per section per day",
        "A cap on how often one section is taken in a day - controller "
        "workload and caution-order churn, not track capacity.",
    ),
    Constraint(
        "C10",
        "Night-working limit",
        "A cap on night blocks per section per week, because night working is "
        "rationed by gang welfare rules and not only by traffic.",
    ),
    Constraint(
        "C11",
        "Technological sequence",
        "Work that must follow other work does: the USFD test precedes the rail "
        "renewal it justifies.",
    ),
)

BY_ID: dict[str, Constraint] = {c.cid: c for c in CONSTRAINTS}


def label(cid: str) -> str:
    """`C8` -> `Machine and gang availability (C8)`, for anything user-facing."""
    c = BY_ID[cid]
    return f"{c.name} ({c.cid})"
