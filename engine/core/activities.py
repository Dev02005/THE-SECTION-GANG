"""
The activity vocabulary - one source of truth.

Every part of the system that needs to know what a maintenance job IS reads it
from here: the task generator, the duration model's training history, the
hazard model's asset mapping, and the pricing layer.

This module exists because the alternative bit us.  The task generator and the
duration model originally carried independent duration tables, drifted apart,
and the model began booking P90 durations of 179 minutes into a corridor that
allows 150 minutes of usable work.  The optimiser dutifully deferred two thirds
of the backlog and missed the statutory obligation.  Nothing was "wrong" in
either file; they simply disagreed, and no test could see it.

`p50_minutes` is the median duration of a nominal single-unit job.  Actual
durations vary around it - by gang, access distance, season, clubbing - and
that variation is what the duration model learns.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from engine.core.schema import SLOT_MIN, Criticality, Department


@dataclass(frozen=True)
class Activity:
    """One maintenance activity, as every layer of the system understands it."""

    code: str
    label: str
    dept: Department
    asset_type: str
    p50_minutes: int
    base_hazard: float
    consequence_minutes: int
    criticality: Criticality
    resources: dict[str, int] = field(default_factory=dict)
    machine: bool = False

    @property
    def p50_slots(self) -> int:
        return max(1, round(self.p50_minutes / SLOT_MIN))


#  Durations are bounded by what a corridor block can actually hold: the policy
#  cap is 180 minutes, of which protection and clearance take 30.  An activity
#  whose median exceeds that would need a mega-block, which this division's
#  corridor policy does not offer.
ACTIVITIES: tuple[Activity, ...] = (
    # ---- Engineering (TMS) ------------------------------------------------ #
    Activity("ENG.RAIL.USFD_FLAW", "USFD flaw removal / rail renewal",
             Department.ENGG, "RAIL", 90, 0.055, 900, Criticality.A,
             {"USFD": 1, "GANG": 1}),
    Activity("ENG.TRACK.DEEP_SCREEN", "Deep screening + tamping",
             Department.ENGG, "RAIL", 120, 0.012, 300, Criticality.B,
             {"TAMPER": 1, "GANG": 1}, machine=True),
    Activity("ENG.WELD.DEFECT", "SEJ / weld defect attention",
             Department.ENGG, "WELD", 60, 0.038, 700, Criticality.A,
             {"GANG": 1}),
    Activity("ENG.TURNOUT.OVERHAUL", "Turnout overhaul",
             Department.ENGG, "TURNOUT", 105, 0.022, 500, Criticality.B,
             {"TAMPER": 1, "GANG": 1}, machine=True),
    Activity("ENG.LC.SURFACE_RENEWAL", "Level crossing surface renewal",
             Department.ENGG, "LEVEL_CROSSING", 75, 0.008, 180, Criticality.C,
             {"GANG": 1}),
    Activity("ENG.BRIDGE.INSPECTION", "Bridge girder inspection",
             Department.ENGG, "BRIDGE", 60, 0.010, 400, Criticality.B,
             {"GANG": 1}),
    # ---- Signal & Telecom (SMMS) ------------------------------------------ #
    Activity("SNT.PM.OVERHAUL", "Point machine overhaul",
             Department.SNT, "POINT_MACHINE", 60, 0.045, 650, Criticality.A,
             {"SNT_CREW": 1}),
    Activity("SNT.TC.FAULT", "Track circuit / axle counter fault",
             Department.SNT, "TRACK_CIRCUIT", 45, 0.060, 800, Criticality.A,
             {"SNT_CREW": 1}),
    Activity("SNT.SIG.LAMP_REPLACE", "Signal lamp + LED replacement",
             Department.SNT, "SIGNAL", 30, 0.014, 200, Criticality.C,
             {"SNT_CREW": 1}),
    Activity("SNT.CABLE.MEGGER", "Cable megger / earth fault",
             Department.SNT, "CABLE", 75, 0.020, 350, Criticality.B,
             {"SNT_CREW": 1}),
    Activity("SNT.IXL.RELAY_TEST", "Interlocking relay testing",
             Department.SNT, "INTERLOCKING", 90, 0.016, 500, Criticality.B,
             {"SNT_CREW": 1}),
    # ---- Traction Distribution (TDMS) ------------------------------------- #
    Activity("TRD.OHE.CONTACT_WIRE", "Contact wire wear replacement",
             Department.TRD, "OHE_SPAN", 90, 0.050, 850, Criticality.A,
             {"TOWER_WAGON": 1, "TRD_CREW": 1}, machine=True),
    Activity("TRD.OHE.DROPPER", "OHE dropper / jumper repair",
             Department.TRD, "OHE_SPAN", 45, 0.030, 400, Criticality.B,
             {"TOWER_WAGON": 1, "TRD_CREW": 1}, machine=True),
    Activity("TRD.OHE.INSULATOR", "Insulator cleaning / replacement",
             Department.TRD, "INSULATOR", 60, 0.018, 300, Criticality.B,
             {"TOWER_WAGON": 1, "TRD_CREW": 1}, machine=True),
    Activity("TRD.OHE.NEUTRAL_SECTION", "Neutral section attention",
             Department.TRD, "NEUTRAL_SECTION", 75, 0.040, 700, Criticality.A,
             {"TOWER_WAGON": 1, "TRD_CREW": 1}, machine=True),
    Activity("TRD.OHE.MAST_SETTING", "Overhead mast / cantilever setting",
             Department.TRD, "MAST", 60, 0.012, 250, Criticality.C,
             {"TOWER_WAGON": 1, "TRD_CREW": 1}, machine=True),
)

BY_CODE: dict[str, Activity] = {a.code: a for a in ACTIVITIES}
BY_LABEL: dict[str, Activity] = {a.label: a for a in ACTIVITIES}
BY_DEPT: dict[Department, tuple[Activity, ...]] = {
    d: tuple(a for a in ACTIVITIES if a.dept is d) for d in Department
}
