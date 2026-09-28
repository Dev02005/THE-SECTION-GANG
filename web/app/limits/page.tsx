import { modelSummary, num } from "@/lib/plan";
import { ProvenanceBanner } from "@/components/ProvenanceBanner";
import { SiteHeader } from "@/components/SiteHeader";
import { DocSection } from "@/components/DocSection";
import { Split, Stat } from "./Parts";
import { loadPlan } from "@/lib/loadPlan";
import { loadBenchmark } from "@/lib/benchmark";
import { loadMonthly } from "@/lib/loadMonthly";

export const dynamic = "force-static";

export const metadata = {
  title: "Limits",
  description:
    "What this system does not know: synthetic data provenance, model validity " +
    "bounds, the optimality gap, and what is designed but not built.",
};

export default async function LimitsPage() {
  const [plan, bench, month] = await Promise.all([loadPlan(), loadBenchmark(), loadMonthly()]);
  const { solver, placement, kpis, shortfall } = plan;

  //  The reference instance, described from the data rather than typed. The
  //  task count used to be `cond ? "90" : "90"` - identical branches, so it
  //  read as derived and was a literal. The candidate-window count is not in
  //  the plan artefact; the benchmark's matching rung measured it.
  const nTasks = plan.optimised.tasks.length;
  const refRung = bench?.rows.find(
    (r) => r.tasks === nTasks && r.sections === plan.sections.length,
  );
  //  DERIVED, not written. This section said "one criticality-A task cannot be
  //  placed" while its own heading read 30 of 35 off the artefact - the page
  //  contradicting itself, and docs/LIMITATIONS.md had already been corrected
  //  to five. Anything countable here now comes from the plan.
  const missed = kpis.optimised.statutory_total - kpis.optimised.statutory_done;
  const binding = [...new Set(shortfall.map((t) => t.bindingConstraint))];
  const m = plan.provenance.modelMetrics ?? {};
  const n = (v: number | undefined, dp = 3) =>
    v === undefined ? "—" : v.toFixed(dp);

  //  One source for these three lines, shared with the dashboard.
  const modelRows: [string, string, string][] = modelSummary(m).map(
    (r) => [r.name, r.result, r.gate],
  );

  return (
    <>
      <SiteHeader />
      <ProvenanceBanner provenance={plan.provenance} />

      <main className="mx-auto w-full max-w-[820px] flex-1 px-6 pb-14">
        <section className="pb-1 pt-12">
          <p className="eyebrow mb-3">Limits</p>
          <h1 className="text-[clamp(2rem,4.5vw,2.9rem)] font-bold leading-[1.05]">
            What this system does not know
          </h1>
          <p className="mt-5 text-[16.5px] leading-relaxed text-ink-mid">
            Written before anyone asked. A system that declares what it does not
            know is easier to trust than one that waits to be caught. Every number
            on this site is computed by code in the repository from the data
            described here.
          </p>
        </section>

        <DocSection n="01" title="The data is synthetic, and that is not a choice">
          <p>
            TMS, SMMS, TDMS, COA and BDMS are internal Indian Railways systems.
            They have no external access, no public API and no published
            extract. The maintenance backlog here is <strong>generated, not
            observed</strong>. That is a hard constraint on any entrant, not a
            shortcut we took.
          </p>
          <Split
            left={{
              h: "Grounded in published practice",
              items: [
                "Two corridors a day — mid-day and night — as most divisions run",
                "Protected paths measured from the timetable: four real premium services, never overlapped",
                "Activity durations from RDSO Track Machine Manual working norms",
                "One tower wagon, one tamper, two USFD units, three gangs — a realistic divisional establishment",
                "Passenger timetable ingested: 480 section traversals by 114 trains",
              ],
            }}
            right={{
              h: "Invented",
              items: [
                "The specific defects and their chainages",
                "Their due dates",
                "The condition history behind each hazard estimate",
                "The daily shape of detention cost the plan is priced with. The timetable is measured and contradicts it; the detention model does not use it yet",
              ],
            }}
          />
          <p>
            The <strong>structure</strong> of the result is defensible: clubbing
            reduces block count because three departments genuinely cannot see
            each other&rsquo;s registers, and that is a property of the problem
            rather than of our data. The <strong>magnitudes</strong> are only as
            good as the generator, whose seed and distributions are published.
          </p>
        </DocSection>

        <DocSection n="02" title="The models train on synthetic data">
          <p>
            All three are validated with real methodology on generated data.
            That bounds what the validation is worth.
          </p>
          <table className="my-4 w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-rule">
                {["Model", "Result", "Gate"].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-mut"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modelRows.map((r) => (
                <tr key={r[0]} className="border-b border-rule-soft">
                  <td className="px-3 py-2 text-ink">{r[0]}</td>
                  <td className="px-3 py-2 text-ink-mid">{r[1]}</td>
                  <td className="px-3 py-2 font-mono text-[12px] text-ink-mut">
                    {r[2]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <strong>What we do not claim.</strong> A concordance of{" "}
            {n(m.hazard?.concordance)} on generated survival data does not
            establish that the model would rank real assets that well. The conformal guarantee holds under
            exchangeability on this data and would need re-establishing on field
            data.
          </p>
        </DocSection>

        <DocSection n="03" title="The optimality gap is wide, and reported anyway">
          <p>
            Two numbers, because they answer different questions.
          </p>
          <dl className="my-4 grid gap-3 sm:grid-cols-2">
            <Stat
              k="Placement"
              v={placement ? `${placement.gapPct}%` : "—"}
              note="Holding the scheduled work fixed: is it placed well? The question a planner asks."
            />
            <Stat
              k="Including what to defer"
              v={solver.gapPct !== null ? `${solver.gapPct}%` : "—"}
              note="The full objective is ~99% deferral penalty, so this measures how many deferrals are provably necessary."
            />
          </dl>
          <p>
            Both are root-LP bounds. <strong>They do not improve with more
            solve time</strong> — only the primal does; we verified that at two
            work budgets and the floor was identical. So we report the floor
            rather than headline a percentage:{" "}
            <em>
              no plan of this work costs less than{" "}
              {num((placement?.bound ?? 0))} detention-minute
              equivalents
            </em>
            . That is a proof. Of the 28 competing repositories, one computes
            a bound and none displays it.
          </p>
        </DocSection>

        <DocSection n="04" title={`Statutory obligation: ${kpis.optimised.statutory_done} of ${kpis.optimised.statutory_total}`}>
          <p>
            {missed} criticality-A {missed === 1 ? "task" : "tasks"} cannot be
            placed within the corridor this horizon offers.{" "}
            {binding.length === 1 ? (
              <>
                <strong>Every one of them is behind the same constraint</strong>{" "}
                — {binding[0]} — the classic divisional bottleneck, which the
                model found without being told to look for it.
              </>
            ) : (
              <>They are bound by {binding.length} distinct constraints.</>
            )}{" "}
            Verified at a 300-second solve as a real capacity limit rather than
            a solver artefact.
          </p>
          <ul className="my-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12.5px] text-ink-mut">
            {shortfall.map((t) => (
              <li key={t.taskId}>
                <span className="text-ink-mid">{t.taskId}</span> ρ {t.riskRate}
              </li>
            ))}
          </ul>
          <p>
            We could have tuned it away. We would rather ship the artefact a DRM
            actually needs — evidence for requesting more corridor — than a
            suspiciously perfect result.
          </p>
        </DocSection>

        <DocSection n="05" title="Designed but not built">
          <p>Named here rather than implied by omission.</p>
          <ul className="my-3 flex flex-col gap-2">
            {[
              ["Reading the Train Signal Register", "The Station Master at each end of a section already records block taken and block returned, by rule, on paper. Those two timestamps are the actual duration of every block ever granted — reading them back would make the duration model the one model grounded in field data instead of generated durations. Not a new field app: a post that already writes the number we need."],
              ["Historical replay harness", "Stage 1 of the rollout, where data-quality problems surface."],
              ["BDMS write-back", "The planner proposes; BDMS grants. We never write to the block register."],
              ["ST-GNN detention surface", "A graph is justified — blocking one section backs traffic into its neighbours — but an unjustified GNN is worse than a justified GBM."],
              ["Continuous replanning", "The replanner is built and works one disruption at a time: /replan re-solves a mid-week USFD flaw with the past frozen, statutory work kept first and the fewest approved jobs changed, and names the resource that would have avoided the cost. It runs offline on a precomputed scenario. What is not built is the loop around it - watching a defect feed and re-solving on its own. That needs feeds this project does not have."],
              ["Un-approving a plan", "No railway un-approves a programme; it supersedes it. Supersession itself is built - re-solving marks the division's earlier plans superseded and keeps them as the record of what was granted. What has no real counterpart is reset_plan, which returns the same plan to draft: this instance is shared, so without it the approval chain could be exercised exactly once. The button says so, and the reset is written to the audit log."],
              ["Serving the plan only from the database", "Sign-in and scoping are applied inside Postgres, so a Northern Railway post gets nothing rather than this division's numbers. But plan.json is still served publicly at /data/plan.json so the application runs for anyone who clones it without a database, and requesting that URL directly still yields the artefact. The scoping is enforced; the file is not."],
            ].map(([h, p]) => (
              <li key={h} className="border-l-2 border-rule pl-3">
                <strong className="text-ink">{h}</strong>
                <br />
                <span className="text-[13.5px] text-ink-mid">{p}</span>
              </li>
            ))}
          </ul>
        </DocSection>

        <DocSection n="06" title="What the approval record proves, and what it does not">
          <p>
            Every plan carries a fingerprint: a SHA-256 of the blocks and tasks
            it grants, printed on the document and written into the append-only
            audit log at submission and at decision.
          </p>
          <ul className="my-3 flex flex-col gap-2">
            {[
              ["Integrity, not correctness", "A matching fingerprint says this is the plan that was approved. It says nothing about whether the plan is good."],
              ["A hash, not a signature", "Who approved comes from the audit row. In this demonstration every post shares one password, printed on the sign-in page, so “approved by the DRM” means approved by someone signed in as the DRM."],
              ["Against users, not the database owner", "Row-level security stops every client from editing the audit log. The project owner and the service-role key bypass it entirely and could rewrite the plan, its hash and the log together. The printed copy is the one outside our control, which is why the fingerprint is printed."],
            ].map(([h, p]) => (
              <li key={h} className="border-l-2 border-rule pl-3">
                <strong className="text-ink">{h}</strong>
                <br />
                <span className="text-[13.5px] text-ink-mid">{p}</span>
              </li>
            ))}
          </ul>
        </DocSection>

        {month && (
          <DocSection n="07" title="The monthly plan is coarse by design, and checked">
            <p>
              It cannot see roads or minutes, so it is held to{" "}
              {month.calibration.packing} work-hours per block-hour &mdash; what
              the weekly solver achieves on a full week, measured. Then it is
              checked: week 1&rsquo;s {month.handoff.allocated} jobs go to the
              weekly solver unchanged, which fits{" "}
              <strong>{month.handoff.scheduled}</strong>. The{" "}
              {month.handoff.misses.length} it cannot place roll into the later
              weeks;{" "}
              {month.handoff.misses.filter((x) => x.criticality === "A").length}{" "}
              of them are statutory and are overdue by then. So the month&rsquo;s{" "}
              {month.totals.statutoryPlaced} of {month.totals.statutoryTotal}{" "}
              statutory placed is the monthly plan&rsquo;s figure, not a promise
              at minute resolution.
            </p>
          </DocSection>
        )}

        <DocSection n="08" title="Scale, and this is not a safety system">
          <p>
            The reference instance is {plan.sections.length} sections,{" "}
            {nTasks} tasks
            {refRung ? <> and {num(refRung.windows)} candidate windows</> : null}{" "}
            over a {plan.horizon.days}-day horizon at{" "}
            {plan.horizon.slotMinutes}-minute slots, solving in about{" "}
            {Math.round(solver.wallTimeS)} seconds. <strong>We have not demonstrated a full division at
            this resolution.</strong> The levers exist, but decomposing across a
            shared resource produces a plan nobody can execute, and the single
            tower wagon usually couples the sections.
          </p>
          <p>
            This is a planning system, not a safety system. It does not touch
            signalling or interlocking, it does not grant blocks, and no output
            is safety-critical in the interlocking sense. It produces the
            proposal that the divisional block meeting reviews and amends.
          </p>
        </DocSection>
      </main>
    </>
  );
}
