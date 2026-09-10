# Corridor — 48-hour build plan

Locked. Upgrades folded in. Work is tiered so slippage costs the least important
thing first.

## Priority tiers

**P0 — the demo fails without it**
Engine with all constraints · three gated models · baseline simulation and real
KPIs · the comparison planner screen with heat strip · deployed and live ·
provenance banner.

**P1 — what moves us from third to first**
Click-a-block counterfactual · Pareto frontier across the policy dials ·
optimality bound displayed · **scale benchmark at 10k tasks** · printable block
plan · landing page with SEO · both themes with toggle · LIMITATIONS.md.

**P2 — only if ahead**
Monthly horizon · priced overrides · controller view.

**Tier by task:** P0 = T1–T6, T12. P1 = T7–T11, T13, T14. P2 = unscheduled.
If we slip, P2 goes first, then P1 polish. T1–T6 and T12 never slip.

**Cut — named on the architecture slide as designed-not-built**
Field app PWA · replay harness · BDMS write-back · ST-GNN · real timetable
ingestion · auth beyond a stub.

---

## Day 1

| Task | Hours | Work | Done when |
|---|---|---|---|
| **T1** | 0–2 | Repo scaffold both sides. Engine core: canonical schema, candidate generation, CP-SAT model C1–C11 | `pytest` green, deterministic |
| **T2** | 2–4 | Three models with promotion gates. XGBoost `survival:cox` for hazard, sklearn discrete-time fallback | Gates pass, cards written |
| **T3** | 4–5 | Baseline simulation, KPI comparison, plan JSON export | Real numbers on disk |
| **T4** | 5–7 | Next.js scaffold, design tokens both themes, **DEPLOY GATE** | A live URL exists |
| **T5** | 7–13 | Comparison planner: time–distance chart, Canvas heat strip, blocks, policy sliders, KPI panel | The core screen works |
| **T6** | 13–15 | Optimality bound, shortfall panel, provenance banner | Differentiators visible |

## Day 2

| Task | Hours | Work | Done when |
|---|---|---|---|
| **T7** | 15–18 | Counterfactual explainer — API endpoint plus click interaction | Click a block, get a reason with a number |
| **T8** | 18–20 | Pareto frontier across the α dials | Trade-off curve renders |
| **T9** | 20–22 | Landing page, SEO metadata, OG image, sitemap, LIMITATIONS.md | Public face done |
| **T14** | 22–25 | **Scale benchmark** — 10k tasks / 60-day horizon, 120-min grid, window pre-filtering. Measure and publish | A real number on screen: tasks, wall time, gap |
| **T10** | 25–27 | Printable block plan | Exports a real railway document |
| **T11** | 27–29 | Responsive pass, theme toggle, accessibility | Works on a phone, keyboard-navigable |
| **T12** | 29–31 | Final deploy, smoke test, verify offline fallback | Live and safe |
| **T13** | 31–34 | Buffer, README, pitch rehearsal | Ready |

---

## Why T14 exists

Performance/scale is our weakest dimension (6/10) and the C++ rival's only
strength (9/10). Their 9 is bought by deleting departments from the problem
entirely — their `struct Task` has no department field, so they do no clubbing
at all. Measuring ourselves at division scale converts our most dangerous
question into a slide, and moves the dimension 6 -> 8.

Levers, in order of cheapness: coarsen `START_STEP_MIN` to 120 · drop candidate
windows with no compatible task · warm-start from the previous horizon ·
decompose by section **only** where no resource couples them (the single tower
wagon usually does, and decomposing across it produces an unexecutable plan).

Report the gap honestly. "10,000 tasks, 90 seconds, 7% from optimal" is a
stronger claim than a better plan with no bound at all.

## Hard rules

1. **The deployed site renders a complete correct plan with the backend off.**
   Static plan JSON is the load path; the API is an enhancement. This removes
   the single largest demo risk.
2. **Deploy at hour 5, not hour 44.** Deployment failure is the most common way
   a hackathon build dies. Find it on Day 1.
3. **A stage is not started until the previous one is done.** The tiers exist so
   that running out of time costs P2, then P1 polish — never P0.
4. **No metric on screen that the code does not compute.**
5. **One screen done exceptionally beats five done adequately.**

## Risk register

| Risk | Mitigation |
|---|---|
| Backend down during demo | Static plan JSON — site works with no API |
| Next build fails on Windows | Deploy gate at hour 5; fallback is Vite SPA, costs only SEO |
| Canvas heat strip stutters | 5,376 cells is well within Canvas budget; SVG fallback for < 1,000 |
| ~~scikit-survival~~ | **Rejected 4 Sep** — `ecos` has no py3.14 wheel. Using XGBoost `survival:cox`, already installed, C-index 0.809 |
| Solver slow on stage | Precomputed plans; live solve is a button, not the load path |
| We over-build | Priority tiers above, enforced |

## The opener

> Every maintenance block is a purchase. It spends line capacity and buys risk
> reduction. Three departments are making that purchase blind to each other and
> blind to what the capacity costs at that hour. We price both sides in the same
> unit — and then buy the most risk reduction per minute of line occupation.

Every rival opens with a feature list. None has a thesis.
