# AI-Powered Automatic Block Planning
## Implementation and Working Document

**Problem statement** — Ministry of Railways, SIH 2026: maximise fixed-asset availability for train operations by replacing decentralised, manual maintenance block planning with a coordinated, data-driven system.

---

## 1. Scope

### 1.1 What the system does

Takes the maintenance arrears and defect registers of three departments — Engineering (P.Way), Signal & Telecommunication, and Traction Distribution — together with the train timetable, goods forecast and corridor policy, and produces a single coordinated block plan over weekly and monthly horizons. The plan says, for every block it proposes: which section and which road, when it starts, how long it runs, and which tasks from which departments are performed inside it.

### 1.2 What it explicitly does not do

- It does not replace the divisional block meeting. It produces the proposal that the meeting reviews and amends.
- It does not grant blocks. BDMS remains the system of record; the planner writes proposals into it.
- It does not touch signalling or interlocking. It is a planning system, not a safety system. No output of this system is safety-critical in the interlocking sense.
- It does not do rolling-stock or coaching maintenance. Fixed infrastructure only.

Stating the second and third points early matters. A judge or a railway officer will ask whether an AI is being put in the safety loop. It is not.

### 1.3 The governing idea

Every maintenance block is a purchase. It spends line capacity — train detention — and buys risk reduction, an asset that will not fail. The three departments currently make that purchase independently, blind to each other and blind to what the capacity costs at that hour on that section.

The system's job is to buy the maximum risk reduction per minute of line occupation, jointly across the three departments, subject to the physical, statutory and resource constraints of the division. Both sides of the trade-off are expressed in one unit: **detention-minute equivalents**.

---

## 2. System overview

Five layers, each independently testable.

| Layer | Responsibility | Where it lives |
|---|---|---|
| 1. Source | TMS, SMMS, TDMS, COA/WTT, BDMS | External, read-mostly |
| 2. Integration | Adapters, canonical schema, event bus, feature store | `adapters/`, `models/common/features.py` |
| 3. Prediction | Hazard model, duration model, detention surface | `models/hazard/`, `models/duration/`, `models/detention/` |
| 4. Optimisation | Candidate generation, CP-SAT model, solve orchestration | `cpsat_model.py`, `data_gen.py` |
| 5. Application | Planner UI, controller view, service, field app | `api/`, `ui/`, `fieldapp/` |

Data flows down layers 1→4 and results flow to layer 5. A single feedback path returns from the field app in layer 5 to the feature store in layer 2, which retrains the layer 3 models.

`architecture.svg` and the process flowchart show this visually and should accompany this document.

---

## 3. Layer 2 — Integration and the canonical model

### 3.1 Why this layer exists

The three maintenance systems have different schemas, different asset identifiers, different notions of what a "task" is, and different update cadences. If any of that leaks into the optimiser, the optimiser becomes unmaintainable and cannot be extended to a fourth department or a second division.

The rule, enforced by `adapters/canonical.py`: **the optimiser never sees a department-specific field.**

### 3.2 Canonical task schema

Defined as `CanonicalTask`. The fields that matter most downstream:

```
task_id            namespaced by source system
department         ENGG | SNT | TRD
asset_id           canonical asset key (see 3.3)
asset_type         drives which hazard model prices it
section_id, line, km
activity_code      controlled vocabulary, mapped per source
criticality        A (statutory) | B | C
due_on             statutory or schedule due date
resources          {resource_code: quantity}
scope_required     LINE | SECTION
needs_power_block, needs_disconnection
predecessors       technological precedence
condition_history  observations feeding the hazard model
```

`activity_code` is the hardest field. Each source system has its own activity vocabulary; `ACTIVITY_VOCABULARY` holds the canonical set and each adapter holds its own mapping table. These are version-controlled, not buried in code. Budget a day for this alone on a real deployment.

The vocabulary also carries the physical implications of each activity — whether it needs a power block, whether it needs a disconnection memo, what scope it requires. `apply_vocabulary_defaults()` fills these in so that a source system which simply does not record "needs a power block" still produces a correct canonical record. `validate()` then rejects any record whose flags contradict the vocabulary.

### 3.3 Canonical asset key

Assets must be identified consistently across systems or the hazard model cannot join condition history to a task. `canonical_asset_key()` keys on `(section_id, line, km rounded to 10 m, asset_type)`, with a manual reconciliation table for exceptions. The rounding is what makes the join work: TMS may record km 47.213 and TDMS km 47.21 for the same location. Report the unmatched rate as a data-quality KPI.

### 3.4 Adapters

One adapter per source, each implementing `to_canonical()`. Transport is a per-site choice, not a per-source one — the same TMS adapter runs over REST at one division and over a CSV drop at another:

- **`RestTransport`** where the source exposes an API. Preferred.
- **`CdcTransport`** where it does not, reading a replica's transaction log. Never the primary.
- **`CsvDropTransport`** as the fallback, with a manifest and SHA-256 per file. A file whose checksum does not match is quarantined rather than ingested, because a half-written CSV looks exactly like a complete one.

Records that fail validation go to quarantine with the reason attached rather than being silently dropped. `IngestResult.unmatched_rate` is the metric to watch.

For the prototype, `data_gen.py` stands in for all four sources and emits the canonical shape directly. Be honest about this in the demo: the adapters are the integration design, and the synthetic generator is calibrated to plausible field distributions.

### 3.5 Feature store and the point-in-time rule

`models/common/features.py:PointInTimeStore` enforces the rule that matters most: when training on an event that happened on date D, every feature must be the value **known on date D**. Training on values known only afterwards produces excellent offline metrics and useless field performance. It is the most common way this kind of pipeline fails silently, and it fails without any error message.

`as_of()` is the only sanctioned way to read features for training. Do not bypass it.

---

## 4. Layer 3 — The prediction models

Three models. All three exist to convert something heterogeneous into a number the optimiser can compare. That is the whole role of ML in this system, and it should be stated that plainly.

### 4.1 Failure hazard model — prices asset risk

**Purpose.** Give every open task a per-slot cost of deferral, so a rail flaw, a sticky point machine and a worn contact wire become directly comparable.

**Method.** Survival analysis per asset type. What ships is a **scikit-learn discrete-time hazard** — person-period expansion with a logistic link, which is a legitimate survival model rather than an approximation. This paragraph previously named lifelines Cox and XGBoost `survival:cox` ahead of it; neither branch was ever written, and there is no `import xgboost` in the engine.

**From hazard to cost.** With C the consequence of failure in detention-minutes:

```
E[loss over d days] = C · (1 − e^(−λd)) ≈ C · λ · d
per-slot cost   ρ = ceil(C · λ / 96 × 1000)
```

**The consequence table C is a policy input, not a learned parameter.** It lives in `models/hazard/train.py:CONSEQUENCE_MINUTES`, agreed with the division from historical incident records, and it is published so it can be argued with. This is where railway judgment enters the system, and burying it inside a model would be wrong.

**Validation.** Concordance (Harrell's C) and Brier skill over the base rate. Measured locally on synthetic data: **C-index 0.690**, positive Brier skill. A C-index of 0.65–0.75 is realistic and useful; the gate rejects anything above 0.95 as probable leakage.

**Cold start.** Asset types with no failure history fall back to a hazard derived from the schedule interval. `HazardService.risk_rates()` returns a `schedule_driven` flag per task so the UI can show these as schedule-driven rather than condition-driven. Hiding that distinction from the planner would be dishonest.

### 4.2 Block duration model — prices time

**Purpose.** Predict how long work actually takes, so blocks are booked realistically instead of padded.

**Method.** Quantile regression at α = 0.5 and 0.9. LightGBM where available, `GradientBoostingRegressor(loss='quantile')` otherwise. Pinball loss penalises under-prediction α/(1−α) times harder than over-prediction, matching the real asymmetry: a block returned late holds trains, a block returned early costs a few idle minutes.

**Conformal calibration — the part that matters.** A gradient-boosted quantile fit is a good conditional estimate but its marginal coverage is not guaranteed. Measured on the shipped models: the raw P90 covered only **0.870**, meaning blocks would still return late roughly one time in eight. Split-conformal calibration (`conformal_delta`, following Romano et al.) adds the α-quantile of held-out calibration residuals and restores the guarantee — coverage rose to **0.921**, inside the gate band, with no hyperparameter tuning, at a padding ratio of 1.23.

This matters operationally. "90% of blocks return on time" has to be a property you can defend, not a number tuned until it looked right. Adding model capacity made coverage *worse* rather than better; the conformal step is the correct fix and it is a distinguishing piece of engineering. (These figures are the ones in `plan.json` under `provenance.modelMetrics`, which is where the site reads them too - the pair quoted here was from an earlier training run and had drifted.)

**Features.** Activity and quantity, section, distance from nearest station (access time dominates short jobs), gang identity, machine involvement, season, time of day, and **whether the block is clubbed**. That last one is not optional: clubbing is what the optimiser's objective rewards, so if the duration model does not know clubbed blocks run differently, the optimiser estimates its own preferred solutions worst.

**Validation.** Not MAE — **coverage**. The gate requires P90 coverage in [0.86, 0.94], P50 in [0.44, 0.56], and a padding ratio under 1.60. A model that is merely accurate on average is not admissible.

**Data hazards to disclose.** BDMS records the block, not the work: a two-hour block holding one 40-minute job labels that job as two hours. Either use task-level logs from the field app, or restrict training to single-task blocks and accept the bias toward small jobs. Blocks curtailed by the controller are right-censored — drop them or use a censored objective, but never train on them silently.

### 4.3 Detention cost surface — prices capacity

**Purpose.** Give the marginal detention-minutes per slot of occupation of a given road of a given section at a given time.

**Method.** ST-GNN in `models/detention/stgnn.py` — spatial message passing over the section adjacency graph feeding a temporal GRU — with a `HistGradientBoostingRegressor` as both fallback and mandatory baseline.

**Why a graph.** Blocking SEC-02 does not only detain trains in SEC-02. It backs traffic into SEC-01 and starves SEC-03. A per-section regression cannot see that; message passing over the adjacency graph can. That is the honest justification and the one to give if challenged.

**The baseline gate.** The ST-GNN is promoted only if it beats the GBM on held-out data. The synthetic generator deliberately gives the baseline neighbour features too, so the comparison is fair — a GNN that wins only because the baseline was starved of features has proven nothing. Measured locally with the GBM: **MAE 5.03 vs naive 26.20, skill 0.808**. If the pilot section is short enough that spillover is negligible, say so and ship the GBM.

### 4.4 Registry and retraining

`models/common/registry.py` versions every model, records a `ModelCard` with metrics and backend, and promotes only on passing the gate. A failed gate keeps the previous model and records why. `current_versions()` is stamped onto every plan, so any plan can be reproduced months later.

Weekly retrain of the duration model — it moves fastest and benefits most. Monthly for hazard and detention.

---

## 5. Layer 4 — The optimiser

The mathematics is in `FORMULATION.md`. This section covers implementation.

### 5.1 Candidate window generation

Corridor policy defines permitted windows per section — typically a mid-day and a night corridor. The generator enumerates candidates on a coarse start grid (`START_STEP_MIN`, default 60 min) across three scopes: UP, DN, SECTION.

Two filters applied at generation, the cheapest possible enforcement:

- Windows overlapping a **protected path** (Vande Bharat, Rajdhani, Shatabdi) are never created.
- Windows on a **blackout day** (festival traffic ban, monsoon patrolling) are never created.

Fixing the start time is the key modelling decision. It makes the detention cost an exact `AddElement` array lookup on duration rather than a nonlinear term, at no loss of fidelity, because corridor policy only permits coarse starts anyway.

### 5.2 The three constraints that carry the most domain weight

- **C7, line occupation.** `NoOverlap` per road, with SECTION-scope windows inserted into *both* roads' sets. One line of code encodes the power-block coupling: OHE work takes the section down, pays double detention, and forbids any other block on either road at that time.
- **C8, resources.** `Cumulative` over tower wagon, tamper, USFD units, gangs and crews. The single tower wagon is usually the binding constraint and the model finds it without being told.
- **C6, containment.** Tasks start after protection is complete and finish before clearance begins. A block does not begin when the gang begins.

### 5.3 Objective and policy dials

```
minimise  α_R · Σ ρ_t · τ_t                    risk carried in-horizon
        + α_R · Σ ρ_t · (T+Δ) · (1−z_t)        risk of deferring out of horizon
        + α_D · Σ tbl_w[δ_w]                   train detention
        + α_F · K · Σ G_w                      fixed overhead of any block
        − α_C · B · Σ e_w                      clubbing reward
```

`e_w` is the number of *extra* departments inside block w. This term is the entire point of the system: it is the only quantity in the objective that no single department can see or express when it bids for its own block through BDMS.

The four α values are policy dials exposed as sliders in the planner UI, not constants. Raise α_D before a festival rush; raise α_R after the monsoon. Every plan records the values used.

### 5.4 Solve orchestration

```
solve(instance, hard_statutory=True)
  → if INFEASIBLE: solve(instance, hard_statutory=False)
      → returns plan + shortfall list
```

Running the statutory constraint hard first means that when a plan is feasible you have a **proof** that every statutory obligation is met, not a claim that the penalty was large enough. Those are different guarantees and an auditor will care which one you have.

When the backlog genuinely exceeds the corridor budget, the soft re-solve returns the plan plus an explicit shortfall list: which statutory items could not be placed, their priced risk, what constraint was binding, and how much extra corridor would clear them. That list is the artefact the DRM needs to argue for more block time with evidence. An optimiser that just says "INFEASIBLE" is useless in an operating railway.

### 5.5 Performance

The reference instance — 4 sections, 90 tasks, 576 candidate windows, 7-day horizon at 15-minute slots — builds to roughly **12,000 booleans and 17,400 constraints**. Target a good feasible solution inside 60 seconds on 8 workers.

Tuning levers if it does not scale to a full division:

- Raise `START_STEP_MIN` to 60 or 120. Halves or quarters the model; costs a few percent of objective.
- Restrict candidate windows to those with at least one compatible task.
- Decompose by section where sections share no resources — but check first, because the shared tower wagon usually couples them, and decomposing across a shared resource produces a plan that cannot be executed.
- Warm-start from last week's plan. Also improves plan stability, which matters more than runtime.

Always report the solver's bound alongside the plan. Telling a division that a plan is within 3% of optimal is worth more than a marginally better plan with no bound. This is the argument for CP-SAT over a genetic algorithm and it should be made explicitly.

### 5.6 Multi-horizon operation

The same model at three granularities, each warm-started from the level above.

| Horizon | Slot | Span | Decides | Cadence |
|---|---|---|---|---|
| Monthly | 60 min | 30 days | Corridor capacity per section; arrears in scope | Before the divisional meeting |
| Weekly | 15 min | 7 days | Task-to-block assignment; the plan issued to BDMS | Weekly |
| Daily | 15 min | 24–48 h | Re-optimisation on firmed forecast, cancelled block, fresh defect | Daily and on trigger |

The previous level's decisions enter as **hints, not constraints**. Controllers will not trust a system whose plan changes completely every run.

---

## 6. Explainability

CP-SAT gives counterfactuals directly: pin one decision, re-solve, report the delta. Every plan line carries a generated explanation:

> Task ENGG-041 (USFD flaw, km 47.2) was deferred to week 3 because placing it Tuesday 10:00 would displace two goods paths worth 84 detention-minutes, while its failure hazard rises only 0.7% over that delay. Placing it in the Thursday 01:00 section block instead costs 11 detention-minutes because it shares protection with the OHE contact-wire job already there.

Two tools built on the same mechanism:

- **Capacity slider** (`POST /capacity`). Raise the corridor cap and show how many arrears clear. This is how the division argues for more block time with evidence rather than assertion.
- **Priced override** (`POST /plan/{id}/override`). A planner moves a block; the system re-solves with that decision pinned and shows what the override costs. It does not refuse. It prices.

The override tool matters for adoption. A system that argues with the Sr.DEN gets switched off. A system that says "you can do that, and here is what it costs" gets used.

---

## 7. Layer 5 — Application

### 7.1 Planner UI (`ui/planner.html`)

Blocks on a time–distance chart with the detention cost surface as a heat strip behind them, so a planner sees immediately whether a block sits in genuinely cheap capacity. Policy dials as sliders. Shortfall panel when statutory work could not be placed.

The time–distance chart is not a design flourish. Controllers read control charts every day; presenting the plan in their native visual language is worth more than any accuracy metric on a slide.

### 7.2 Controller view (`ui/controller.html`)

Read-only. Granted blocks overlaid on the train graph, with protected paths in amber. A block drawn across a protected path would be a planning error — and cannot happen, because those candidate windows are removed before the optimiser sees them.

### 7.3 Field app (`fieldapp/`)

The closed loop. Offline-first PWA, four inputs: block start, block returned, work completed, reason for overrun. Reports are written to IndexedDB first and synced opportunistically; the app never blocks on the network, because mid-section sites have no reliable data. Server-side reconciliation is on `(block_id, task_id)`, so a duplicate sync is harmless.

Without this app the duration model never improves and the whole system is a one-shot demo. It is the least glamorous component and the most important one. Build it early, not last.

### 7.4 BDMS write-back

The planner proposes; BDMS grants. Write-back posts proposed blocks as demands with a plan reference and reads back the granted status. Never write directly to the block register. The division's existing approval workflow stays exactly where it is.

---

## 8. Deployment and operations

### 8.1 On-premises, not cloud

Railway operational data does not leave railway infrastructure. Assume an on-premises deployment inside the divisional network, containerised, with no external calls at inference time. Models train and serve locally. Say this before you are asked; it is the first question an IT security reviewer raises.

### 8.2 Access control and audit

Roles in `api/auth.py`: approver (Sr.DEN / Sr.DSTE / Sr.DEE), section engineer, controller, field. Every mutating call is attributed.

Plans are versioned and **immutable once issued**, recording: input snapshot hash, model versions, α values, solver status and bound, and every manual override with author, timestamp and priced cost. An override does not edit a plan; it creates a new version.

This is a requirement, not a nicety. The first time a block plan is questioned after an incident, the audit trail is what the system is judged on.

---

## 9. Rollout

Five stages. Do not skip stage 2.

**Stage 1 — Historical replay (4 weeks).** `tests/replay/replay.py` over six months of past data for one division. No live use. This is where the data quality problems are found.

**Stage 2 — Shadow mode (8 weeks).** The system generates a plan every week alongside the real process. Nobody acts on it. This builds the evidence base and, more importantly, builds trust — officers watch it be right, or watch it be wrong in ways they can explain, before anything is at stake.

**Stage 3 — Advisory pilot (12 weeks).** One division. The plan goes to the block meeting as the starting proposal. Every override is logged with its reason; the override log is the richest feedback the system will ever get, and reviewing it monthly is how the constraint set gets corrected.

**Stage 4 — Adoption (6 months).** The plan becomes the default. Overrides still logged. KPIs reported to the divisional meeting.

**Stage 5 — Scale.** Additional divisions, retrained per division. Do not assume a model transfers, particularly the detention surface.

---

## 10. Testing

| Layer | Test | Status |
|---|---|---|
| Adapters | Golden-file: raw payload in, canonical record out | `tests/test_adapters.py` — 9/9 pass |
| Canonical model | Schema validation, vocabulary coverage, asset-key join | covered above |
| Hazard | Concordance and Brier skill, per asset type | gate in `models/hazard/train.py` |
| Duration | Coverage at P90, pinball loss, padding ratio | gate in `models/duration/train.py` |
| Detention | Held-out MAE, beat-the-GBM-baseline gate | gate in `models/detention/train.py` |
| Optimiser | One test per constraint C1–C11 | `tests/constraints/test_constraints.py` |
| End-to-end | Historical replay | `tests/replay/replay.py` |

The constraint tests deserve emphasis. For each constraint, construct a small instance where that constraint is the only thing preventing an obviously better solution, and assert the model does not take it. A constraint that is written but not tested is a constraint that silently is not enforced, and here that means shipping a plan nobody can execute.

---

## 11. Acceptance criteria

Measured against a simulation of current practice on the same backlog:

| KPI | Direction | Target |
|---|---|---|
| Block utilisation (work-hours per block-hour) | Up | > 1.5× baseline |
| Discrete blocks for the same work | Down | Falls sharply through clubbing |
| Train detention per task completed | Down | > 30% reduction |
| Statutory (criticality-A) arrears closed | Up | 100% where feasible; explicit shortfall where not |
| Blocks returned late | Down | < 10% |
| P90 duration coverage | Calibrated | 88–92% |
| Plan generation time, weekly horizon | — | < 60 s |
| Plan stability week to week | — | > 80% of blocks unchanged absent new information |

The last two are adoption criteria rather than performance criteria, and they matter as much as the others.

---

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| BDMS actuals record blocks, not tasks | Duration model trains on wrong labels | Field app task-level logging; restrict to single-task blocks meanwhile and state the bias |
| Source systems have no API | Integration stalls | CDC on replica, or CSV drop with manifest. Transport is a per-site choice |
| Asset identity does not reconcile | Hazard model cannot join history | Canonical asset key plus maintained reconciliation table; report unmatched rate |
| Optimiser does not scale to a division | Unusable | Coarser slots, window pre-filtering, warm start, careful decomposition |
| Officers do not trust the plan | Non-adoption | Shadow mode, counterfactuals, priced overrides rather than refused overrides |
| Detention surface poorly calibrated | Blocks placed in expensive capacity | GBM baseline gate; shadow-mode comparison against actual control charts |
| Consequence table C is contested | Priorities disputed | C is a published policy input agreed with the division, not a learned parameter |

---

## 13. Hackathon build plan

**Scope.** One 60–80 km double-line electrified section pair, three departments, ~500 tasks, six months of synthetic history. Weekly plan in under 10 seconds. Two screens.

**Hours 0–6.** Canonical schema and synthetic generator. Freeze the schema early; everything depends on it.

**Hours 6–14.** CP-SAT model with C1–C11. Get a feasible plan out before touching any ML.

**Hours 14–20.** The three models. Keep them simple; a well-validated LightGBM beats an unvalidated GNN in front of judges.

**Hours 20–28.** Planner UI with the time–distance chart. This is the screen that wins the demo.

**Hours 28–32.** Counterfactual explainer and capacity slider.

**Hours 32–36.** Baseline comparison, KPI slide, rehearse.

**Cut first if time runs short:** the ST-GNN, replaced by gradient boosting. The monthly horizon. The field app, replaced by a mocked actuals feed — but keep it on the architecture slide and say it is mocked.

**Never cut:** the baseline comparison. A plan with no baseline is a screenshot. A plan with a baseline is a result.
