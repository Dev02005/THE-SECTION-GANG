"""Solver constants. Everything priced in scaled detention-minute equivalents."""

from __future__ import annotations

from engine.core.schema import SCALE, SLOTS_DAY

#  Protection, caution order and the first train back over the site.  Real
#  minutes: a block does not begin when the gang begins.
SETUP_SLOTS = 1
CLEAR_SLOTS = 1

#  The fixed overhead of granting ANY block, whatever its length.  This is why
#  four one-hour blocks are worse than one four-hour block at equal detention.
FIXED_BLOCK_COST = 15 * SCALE

#  Reward per EXTRA department sharing a block.  The coordination term that no
#  single department can express when it bids alone through BDMS.
CLUB_BONUS = 25 * SCALE

#  Deferring past the horizon is treated as three more weeks of accrued risk.
DEFER_PENALTY_SLOTS = 21 * SLOTS_DAY

#  Only used when the statutory obligation has to be softened because the
#  backlog genuinely exceeds the corridor budget.
STATUTORY_SOFT_PENALTY = 5_000 * SCALE

MAX_BLOCKS_PER_SECTION_DAY = 2
MAX_NIGHT_BLOCKS_PER_SECTION_WEEK = 4
