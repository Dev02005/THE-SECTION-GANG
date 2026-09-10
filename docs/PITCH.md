# The ten minutes

A running order, and the questions we want asked.

Our position is unusual: we are the only entrant who gets **stronger** under a
technical probe. Four of the seven rivals publish headline numbers their own
code manufactures. The pitch should therefore invite the hard question rather
than hope nobody asks it.

---

## 0:00 — The thesis, before any screen

Say this before opening anything. Thirty seconds, no slides.

> Every maintenance block is a purchase. It spends line capacity — train
> detention — and it buys risk reduction, an asset that will not fail.
>
> Three departments are making that purchase today blind to each other, and
> blind to what the capacity costs at that hour on that section.
>
> We price both sides in the same unit and buy the most risk reduction per
> minute of line occupation.

Every rival opens with a feature list. None of them has a thesis.

---

## 0:30 — The structural problem

Three registers — TMS, SMMS, TDMS — and no department can see the other two.
So an S&T crew takes a two-hour block at km 47 on Tuesday, a P.Way gang takes
another at km 48 on Thursday, and a TRD crew takes a section block at km 47.5
on Saturday. Three sets of protection, three caution orders, three sets of
detained trains. **One block could have carried all three.**

That is not a failure of diligence. It is structural, and it is why no
department can propose the fix.

---

## 1:30 — The screen. One screen.

Open `/planner`. Do not narrate the UI — let the picture do it.

**Point at the two charts.** Same axes. Same corridor. Above: 43 blocks,
one department each. Below: 18 blocks, most carrying two or three.

**Point at the red.** That is the detention cost surface — what blocking that
road at that moment actually costs in train delay. The plan threads through
the gaps. *No rival can draw this: it requires a cost surface and none of the
seven computes one.*

**Then the numbers**, which are on screen and computed by one function scoring
both plans on one instance:

> 43 blocks to 18. Packing 0.82 to 2.06 — two and a half times the work per
> hour of line occupation, and 48 jobs done against 43. Statutory arrears 20 of 35 closed, to 34 of 35.

---

## 3:30 — Click a block

This is the moment. Let them pick it.

> Three jobs from three departments share this block. Done separately they
> would cost 750 detention-minutes against 464 here — 286 saved, plus 30 in
> avoided block overheads.

Then click one where sharing **cost** more, and read that out too. Two of the
fourteen shared blocks are like this — both are two jobs from the *same*
department, so it is a sharing cost rather than a clubbing cost. Reading it
aloud is worth more than the saving:

> Sharing avoids 15 detention-minute equivalents of block overhead but costs 33
> more in detention — 319 here against 286 apart — because a section block pays
> both roads. The optimiser still chose it, which means the binding reason is
> elsewhere: a statutory date, a committed resource, a precedence.

The first version of that sentence reported only the 15 saved and stayed silent
on the 33 it cost. A test caught it. That is the arithmetic we criticise in the
field, and we had to be caught doing it ourselves before it was fixed.

---

## 4:30 — Sign in as Sr.DEN, and show the number that hurts

`/login` opens on **East Coast Railway → Waltair**, and the two pickers above
the posts are the Ministry list — 17 zones, 68 divisions. Pick **Sr.DEN**. The
planner gains one panel: that department's own stake. Read it out, including
the bad half — it is the strongest thirty seconds in the pitch.

> Traction does **one** job under current practice on this corridor, and closes
> **none of its nine statutory items**. Under the joint plan it does seven, and
> closes four of the nine.
>
> Engineering gives up almost nothing for that — 23 jobs to 22 — and closes
> **all twelve** of its statutory items instead of ten. S&T does the same
> nineteen jobs and goes from eleven of fourteen statutory to all fourteen.

That is the structural problem in one screen. Current practice hands the
corridor to whoever reaches it first; Engineering has the largest register, so
it takes most of the capacity and Traction carries the arrears. Division
statutory goes **21/35 → 30/35** once the corridor is shared — and the nine
that remain are a machine problem, not a planning one.

**Then say the part that is still missing.** Traction closes four of nine, not
nine of nine. The other five are the shortfall list, and every one of them is
behind the single tower wagon. A judge who finds that themselves thinks we hid
it; a judge who is handed it sees a system that reports against its own
headline — and the aggregate KPIs above genuinely do hide it.

---

## 5:00 — The three things no rival has

**The bound.** *No plan of this work costs less than 30,093,381 detention-minute
equivalents. Ours costs 31,883,629 — within 5.6%.* That is a proof, not an estimate. Five
rivals run solvers capable of producing a bound; none surfaces it.

**The shortfall list.** Five statutory tasks cannot be placed, and every one is
behind the single tower wagon. *We could have tuned them away. Five statutory
items stuck behind one machine is exactly the paper a DRM takes to the zonal
allocation meeting.*

**The trade-off curve.** Seven re-solves across the risk weight. Buying risk
down costs roughly 1,000 detention-minutes per 900 of risk cleared. The dials
are not a gimmick; this is the price list.

---

## 7:00 — The document

Open `/plan`. Print preview it.

> Railway planning happens on paper. This is the plan as a division would issue
> it — block reference, section and scope, protection and clearance shown, work
> by department with chainage, and a signature block for the three officers.
> It says on its face that it is a proposal, not a grant. BDMS remains the
> system of record.

---

## 8:00 — Say the limitation before you are asked

Do not wait for this question. Take it.

> The maintenance backlog is generated. TMS, SMMS, TDMS, COA and BDMS have no
> external access — that is true for every team in this room. The difference is
> that we say so: there is a banner on every page, a limitations page, and it
> is printed on the document itself.
>
> The corridor policy, the protected paths and the traffic shape follow
> published practice. The specific defects are ours.

---

## The questions we want

**"Does this scale to a zone?"**
A zone is not a bigger division; it is a different job. A division *schedules* —
which four hours on Thursday, at 15-minute resolution. A zone *allocates* —
which division holds the tamper this season. Sign in as **GM/ECoR** and the
panel says so: three divisions, one plan, five posts at that level. The
allocation is also what makes the split legitimate, and it is why we refused
to decompose by section: one tower wagon couples every section inside a
division, so a section-by-section solve double-books it. Resolve that coupling
one level up and the divisions genuinely separate.

**"Does this scale?"**
Feasible to about a thousand tasks across twenty sections in two minutes.
It breaks at two and a half thousand — that is on the `/scale` page with the
failing rungs shown. At ten thousand the model builds and the solver finds
nothing in twelve minutes.
*The C++ entry does ten thousand in milliseconds because its task struct has no
department field. It does no clubbing at all. That is not a faster solution to
this problem; it is a fast solution to a smaller one.*

**"How close to optimal is this?"**
Yes, and we report it. The objective is roughly 99% out-of-horizon deferral
penalty, so that number measures how many deferrals are *provably* necessary —
not a question anyone asks in a block meeting. Hold the work fixed and ask
whether it is placed well: **5.6%**. Both are on screen. Neither is headlined,
because the defensible claim is the floor.

**"Is AI in the safety loop?"**
No. It does not touch signalling or interlocking, it does not grant blocks, and
no output is safety-critical in the interlocking sense. It produces the proposal
the divisional block meeting reviews and amends.

**"How do I know the numbers are real?"**
One scoring function, one instance, both sides. There is a test asserting the
detention comes from the instance surface rather than from a number the solver
wrote. *A competing submission scores its own plan at priority × 0.15 and its
baseline at × 0.08, and reports the difference as 500 hours saved.*

**"Will the plan change if I run it again?"**
No. Deterministic mode fixes a *work* budget rather than a wall clock — a clock
truncates the search wherever the machine happens to be. A test hashes the whole
artefact across two runs and asserts they match.

---

## What not to do

- Do not claim the models are validated on real data. They are not, and the
  limits page says so.
- Do not quote the placement gap without its restriction. The restriction
  travels with the number and a test enforces that.
- Do not say "100% statutory". It is 30 of 35, and the five that are missing —
  all behind one tower wagon — are the better story.
- Do not out-feature anyone. One screen done exceptionally. A rival with
  nineteen engine modules has an objective disconnected from its decision
  variables.
