import { num } from "@/lib/plan";
import { DocSection } from "@/components/DocSection";
import { ProvenanceBanner } from "@/components/ProvenanceBanner";
import { RequireSignIn } from "@/components/RequireSignIn";
import { SiteHeader } from "@/components/SiteHeader";
import { loadPlan } from "@/lib/loadPlan";
import { loadBenchmark } from "@/lib/benchmark";

export const dynamic = "force-static";

export const metadata = {
  title: "Scale",
  description:
    "How far the optimiser scales, measured: instance size against solve time, " +
    "solution quality and where it stops being viable.",
};

/**
 * The scale answer, measured.
 *
 * Scale is the one dimension where a rival beats us, and it is worth being
 * precise about how. The C++ entry schedules 10,000 tasks in milliseconds - by
 * having no department field in its task struct at all. It does no clubbing,
 * which is the thing this problem statement actually asks for. That is not a
 * faster solution to the same problem; it is a fast solution to a smaller one.
 *
 * What follows is what our optimiser - which does model departments, resources
 * and line occupation - actually achieves, including where it stops.
 */
export default async function ScalePage() {
  const [plan, bench] = await Promise.all([loadPlan(), loadBenchmark()]);

  //  Feasible is not the same as useful. The largest rung that solves is read
  //  from the data, with how much of its work it actually placed - the "Status"
  //  column alone called a plan feasible that placed 46 jobs out of 1,000.
  const solved = (bench?.rows ?? []).filter(
    (r) => r.status === "OPTIMAL" || r.status === "FEASIBLE",
  );
  const largest = solved.length ? solved[solved.length - 1] : null;

  return (
    <>
      <SiteHeader />
      <ProvenanceBanner provenance={plan.provenance} />

      <RequireSignIn>
      <main className="mx-auto w-full max-w-[980px] flex-1 px-6 pb-14">
        <section className="pb-1 pt-12">
          <p className="eyebrow mb-3">Scale</p>
          <h1 className="text-[clamp(2rem,4.5vw,2.9rem)] font-bold leading-[1.05]">
            How far it goes, and where it stops
          </h1>
          <p className="mt-5 max-w-[86ch] text-[16.5px] leading-relaxed text-ink-mid">
            Measured, including the rungs that fail. A scale claim without the
            failures is a marketing number.
          </p>
        </section>

        {bench === null ? (
          <p className="mt-8 rounded border border-rule bg-surface p-4 text-[14px] text-ink-mut">
            Benchmark not yet generated. Run{" "}
            <code className="font-mono text-[13px]">python -m engine.benchmark</code>.
          </p>
        ) : (
          <>
            <div className="mt-8 overflow-x-auto rounded-lg border border-rule bg-surface">
              <table className="w-full min-w-[820px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-rule">
                    {[
                      "Tasks", "Sections", "Days", "Grid", "Windows",
                      "Assign vars", "Build", "Solve", "Status", "Blocks",
                      "Done", "Statutory", "Clubbed",
                    ].map((h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-mut ${
                          i === 8 ? "text-left" : i === 0 ? "text-left" : "text-right"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bench.rows.map((r) => {
                    const ok = r.status === "OPTIMAL" || r.status === "FEASIBLE";
                    return (
                      <tr
                        key={`${r.tasks}-${r.sections}`}
                        className={`border-b border-rule-soft last:border-0 ${
                          ok ? "" : "bg-danger-soft"
                        }`}
                      >
                        <td className="tnum px-3 py-2 font-mono font-medium text-ink">
                          {num(r.tasks)}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                          {r.sections}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                          {r.horizon_days}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mut">
                          {r.start_step_min}m
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                          {num(r.windows)}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                          {num(r.assignment_vars)}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mut">
                          {r.build_time_s.toFixed(1)}s
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mut">
                          {r.solve_time_s.toFixed(0)}s
                        </td>
                        <td
                          className={`px-3 py-2 font-mono text-[11.5px] ${
                            ok ? "text-go" : "text-danger"
                          }`}
                        >
                          {r.status}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                          {ok ? r.blocks : "—"}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                          {ok ? num(r.scheduled) : "—"}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                          {ok ? `${num(r.statutory_done)}/${num(r.statutory_total)}` : "—"}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                          {ok ? `${r.multidept_pct}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-3 max-w-[74ch] text-[12px] leading-relaxed text-ink-mut">
              {bench.note} Each rung had {bench.secondsPerRung} seconds.
            </p>
            {largest && largest.tasks !== solved[0].tasks && (
              <p className="mt-3 max-w-[80ch] rounded border border-caution bg-caution-soft px-3 py-2 text-[13px] leading-relaxed text-ink">
                <strong>Feasible is not the same as useful.</strong> The largest
                rung that solves, {num(largest.tasks)} tasks, placed{" "}
                {num(largest.scheduled)} of them and closed{" "}
                {num(largest.statutory_done)} of{" "}
                {num(largest.statutory_total)} statutory items, with{" "}
                {largest.multidept_pct}% of blocks shared. Read the Done and
                Statutory columns, not only Status: quality gives out well
                before feasibility does.
              </p>
            )}
          </>
        )}

        <DocSection title="What makes it fit">
          <p>
            The variable that matters is the number of (task, window)
            assignments. Two of them are exact reductions — they delete no
            solution:
          </p>
          <ul className="my-3 flex flex-col gap-2">
            <li className="border-l-2 border-rule pl-3">
              <strong className="text-ink">Impossible pairs removed.</strong> A
              task that cannot fit a window&rsquo;s policy cap, or cannot finish
              by its due date even starting the instant protection completes, is
              never given a variable. Both are already constraints, so this is
              exact — and it removes <strong>91% of the variables</strong> at
              division scale: 2,994,132 compatible pairs down to 278,736 on the
              10,000-task rung, and 51% on the reference instance (measured 28
              Sep).
            </li>
            <li className="border-l-2 border-rule pl-3">
              <strong className="text-ink">Coarser start grid.</strong> Corridor
              policy only permits coarse block starts anyway, so moving from a
              60-minute to a 120-minute grid costs nothing real.
            </li>
          </ul>
          <p>
            <strong>Deliberately not used: decomposition by section.</strong>{" "}
            It would help, and it would be wrong. The single tower wagon couples
            the sections, so a plan solved section-by-section double-books it
            and cannot be executed. A faster wrong answer is not an improvement.
          </p>
        </DocSection>

        <DocSection title="The comparison worth making">
          <p>
            A competing entry schedules 10,000 tasks over 60 days in
            milliseconds with a C++ greedy matcher. Its{" "}
            <code className="rounded bg-surface-sunk px-1 font-mono text-[12.5px]">
              struct Task
            </code>{" "}
            holds an id, a duration, a severity and an overdue count —{" "}
            <strong>and no department</strong>. It therefore does no clubbing at
            all, which is the coordination this problem statement exists to
            solve.
          </p>
          <p>
            That is not a faster solution to the same problem. It is a fast
            solution to a smaller one, and the honest way to place our numbers
            beside theirs is to say so rather than to quote a throughput figure
            we would have to shrink the problem to match.
          </p>
        </DocSection>
      </main>
      </RequireSignIn>
    </>
  );
}

