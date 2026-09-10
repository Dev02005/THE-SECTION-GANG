"""
Canonical schema.

One shape for every department.  The optimiser never sees a department-specific
field, which is what lets a fourth department be added by writing an adapter
rather than by touching the solver.

Pydantic v2 rather than dataclasses so the same definitions generate the
TypeScript types the web app consumes.  The contract cannot drift.

Time model
----------
SLOT_MIN   15 minutes   (BDMS grants are quarter-hour granular)
SLOTS_DAY  96
HORIZON    7 days -> 672 slots for the weekly plan
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, computed_field

SLOT_MIN = 15
SLOTS_DAY = 24 * 60 // SLOT_MIN
HORIZON_DAYS = 7
HORIZON_SLOTS = SLOTS_DAY * HORIZON_DAYS

#  CP-SAT wants integer coefficients; every cost in the model is scaled by this
#  and divided back out only for display.
SCALE = 1000


class Department(StrEnum):
    ENGG = "ENGG"
    SNT = "SNT"
    TRD = "TRD"


class Line(StrEnum):
    UP = "UP"
    DN = "DN"
    BOTH = "BOTH"


class Scope(StrEnum):
    """What a block takes out of use."""

    UP = "UP"
    DN = "DN"
    SECTION = "SECTION"


class Criticality(StrEnum):
    A = "A"  # statutory - must be done this horizon
    B = "B"
    C = "C"


DEPARTMENTS: tuple[Department, ...] = (Department.ENGG, Department.SNT, Department.TRD)
ROADS: tuple[Line, ...] = (Line.UP, Line.DN)


class Section(BaseModel):
    """A block section between two stations."""

    model_config = ConfigDict(frozen=True)

    sid: str
    name: str
    km_from: float
    km_to: float
    double_line: bool = True


class Task(BaseModel):
    """
    One maintenance job from a departmental register, in canonical form.

    `hazard` x `consequence` is what prices deferral.  We do not rank tasks; we
    price them, in the same unit as train detention.
    """

    tid: str
    dept: Department
    section: str
    line: Line
    km: float
    activity: str
    criticality: Criticality

    p50: Annotated[int, Field(ge=1)]  # slots, median duration
    p90: Annotated[int, Field(ge=1)]  # slots, what we book
    due_slot: int

    hazard: Annotated[float, Field(ge=0.0, le=1.0)]  # daily failure probability
    consequence: Annotated[int, Field(ge=0)]  # detention-minutes if it fails

    resources: dict[str, int] = Field(default_factory=dict)
    needs_power_block: bool = False
    needs_disconnection: bool = False
    predecessors: list[str] = Field(default_factory=list)

    #  True when the hazard came from a schedule interval rather than observed
    #  condition.  Surfaced in the UI - hiding it from the planner would be
    #  dishonest.
    schedule_driven: bool = False

    @computed_field  # type: ignore[prop-decorator]
    @property
    def booked(self) -> int:
        """Duration we actually book: the calibrated P90."""
        return self.p90

    @computed_field  # type: ignore[prop-decorator]
    @property
    def risk_rate(self) -> int:
        """
        Cost per SLOT of deferring this task, in scaled detention-minutes.

            E[loss over d days] = C(1 - e^-Ld) ~= C * L * d
            rho = ceil(C * L / slots_per_day * SCALE)

        Linear in d over the horizons we plan, so CP-SAT can use it directly.
        """
        per_day = self.hazard * self.consequence
        return max(1, round(per_day / SLOTS_DAY * SCALE))


class CandidateWindow(BaseModel):
    """
    A *possible* block, enumerated from corridor policy.  The optimiser decides
    which to grant and how long each actually runs.

    The start is FIXED per candidate.  That is the key modelling decision: it
    turns the detention cost into an exact array lookup on duration instead of a
    nonlinear term, and costs nothing, because corridor policy only permits
    starts on a coarse grid anyway.
    """

    model_config = ConfigDict(frozen=True)

    wid: str
    section: str
    scope: Scope
    day: int
    start: int  # absolute slot
    max_dur: int  # slots, corridor policy cap
    power_block: bool  # traction power may be switched off in this window
    night: bool


class PolicyWeights(BaseModel):
    """
    The dials a Sr.DEN turns.  Raise detention before a festival rush; raise
    risk after the monsoon.  Recorded against every plan.
    """

    alpha_risk: Annotated[float, Field(ge=0)] = 1.0
    alpha_detention: Annotated[float, Field(ge=0)] = 1.0
    alpha_fixed: Annotated[float, Field(ge=0)] = 1.0
    alpha_club: Annotated[float, Field(ge=0)] = 1.0


class PlannedTask(BaseModel):
    tid: str
    dept: Department
    section: str
    activity: str
    criticality: Criticality
    window: str | None = None
    start: int | None = None
    end: int | None = None
    scheduled: bool
    risk_rate: int
    schedule_driven: bool = False


class PlannedBlock(BaseModel):
    wid: str
    section: str
    scope: Scope
    day: int
    start: int
    dur: int
    depts: list[Department]
    tasks: list[str]
    detention_minutes: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def clubbed(self) -> bool:
        return len(set(self.depts)) > 1


class Shortfall(BaseModel):
    """Statutory work that could not be accommodated. The DRM's evidence."""

    tid: str
    criticality: Criticality
    risk_rate: int
    binding_constraint: str


class SolveStats(BaseModel):
    """
    The bound is the point.  Telling a division a plan is within 3% of optimal
    is worth more than a marginally better plan with no bound at all, and it is
    the argument for CP-SAT over a metaheuristic.
    """

    status: str
    objective: int
    bound: int | None = None
    gap_pct: float | None = None
    wall_time_s: float
    conflicts: int = 0
    branches: int = 0
    deterministic: bool = True


class Plan(BaseModel):
    blocks: list[PlannedBlock]
    tasks: list[PlannedTask]
    shortfall: list[Shortfall] = Field(default_factory=list)
    weights: PolicyWeights
    stats: SolveStats
    statutory_hard: bool = True
