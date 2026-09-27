"use client";

import { useMemo, useState } from "react";
import type { ChartRow } from "@/components/planner/TimeDistanceChart";
import { TimeDistanceChart } from "@/components/planner/TimeDistanceChart";
import { KpiStrip } from "@/components/planner/KpiStrip";
import { DepartmentGantt } from "@/components/planner/DepartmentGantt";
import { Legend } from "@/components/planner/Legend";
import { ParetoChart } from "@/components/planner/ParetoChart";
import { PolicyDials } from "@/components/planner/PolicyDials";
import { RolePanel } from "@/components/planner/RolePanel";
import { ShortfallPanel } from "@/components/planner/ShortfallPanel";
import { SolverPanel } from "@/components/planner/SolverPanel";
import type { PlanBlock, PlanPayload } from "@/lib/plan";
import { DAY_NAMES, DEPT_LABEL } from "@/lib/plan";

/**
 * The planner screen is a COMPARISON, not a plan.
 *
 * Current practice above, the optimised plan below, the same axes and the same
 * detention surface behind both. That framing is the differentiator: it needs
 * a baseline simulation and a cost surface, and no competing submission has
 * either. It turns an engineering advantage into something visible in two
 * seconds rather than something you would have to read the code to believe.
 */
export function PlannerView({ plan }: { plan: PlanPayload }) {
  const [selected, setSelected] = useState<PlanBlock | null>(null);

  const rows: ChartRow[] = useMemo(
    () =>
      plan.sections.flatMap((s) =>
        plan.roads.map((road) => ({ section: s.id, road })),
      ),
    [plan],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-5">
        <RolePanel plan={plan} />

        <KpiStrip
          baseline={plan.kpis.baseline}
          optimised={plan.kpis.optimised}
          deltas={plan.kpis.deltas}
        />

        <TimeDistanceChart
          plan={plan}
          blocks={plan.baseline.blocks}
          rows={rows}
          title="Current practice"
          subtitle={`${plan.kpis.baseline.blocks} blocks · one department each · earliest slot available`}
          onSelect={setSelected}
          selectedId={selected?.id ?? null}
        />

        <TimeDistanceChart
          plan={plan}
          blocks={plan.optimised.blocks}
          rows={rows}
          title="Optimised joint plan"
          subtitle={`${plan.kpis.optimised.blocks} blocks · ${plan.kpis.optimised.multidept_pct}% carry more than one department`}
          onSelect={setSelected}
          selectedId={selected?.id ?? null}
        />

        {/*  The same optimised blocks, grouped by department instead of by
             section. The charts above answer "what is occupied"; this
             answers "who is on the line, and with whom" - the question the
             three Sr. officers bring to the block meeting.  */}
        <DepartmentGantt
          plan={plan}
          blocks={plan.optimised.blocks}
          onSelect={setSelected}
          selectedId={selected?.id ?? null}
        />

        <Legend />

        <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-ink-mut">
          Both charts share one x-axis and one detention surface. A block
          sitting in a darker band is buying risk reduction at a high price —
          that trade-off is what the objective makes explicit, and it is the
          reason the lower plan uses fewer, better-placed blocks to do more
          work.
        </p>
      </div>

      <aside className="flex flex-col gap-4">
        <BlockDetail
          block={selected}
          explanation={selected ? plan.explanations[selected.id] : undefined}
          onClear={() => setSelected(null)}
        />
        <SolverPanel solver={plan.solver} placement={plan.placement} />
        <ShortfallPanel
          optimised={plan.shortfall}
          baseline={plan.baselineShortfall}
        />
        <PolicyDials weights={plan.weights} />
        <ParetoChart pareto={plan.pareto} />
      </aside>
    </div>
  );
}

function BlockDetail({
  block,
  explanation,
  onClear,
}: {
  block: PlanBlock | null;
  explanation?: PlanPayload["explanations"][string];
  onClear: () => void;
}) {
  if (!block) {
    return (
      <section className="rounded-lg border border-dashed border-rule bg-surface p-4">
        <h3 className="eyebrow mb-1.5">Block detail</h3>
        <p className="text-[12.5px] leading-relaxed text-ink-mut">
          Select any block in either chart to see what it carries, what it
          costs, and what clubbing saved.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-rule bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="eyebrow">Block detail</h3>
        <button
          onClick={onClear}
          className="font-mono text-[11px] text-ink-mut hover:text-ink"
        >
          clear
        </button>
      </div>
      <p className="font-display text-[17px] font-bold leading-tight text-ink">
        {block.section} · {block.scope}
      </p>
      <p className="tnum mt-0.5 font-mono text-[12px] text-ink-mid">
        {DAY_NAMES[block.day % 7]} {block.startHHMM}–{block.endHHMM} ·{" "}
        {block.durationMin} min
      </p>
      <p className="tnum mt-2 font-mono text-[12px] text-ink-mut">
        {block.detentionMinutes} detention-min ·{" "}
        {block.clubbed ? (
          <span className="text-clubbed">
            {block.departments.length} departments
          </span>
        ) : (
          DEPT_LABEL[block.departments[0]]
        )}
      </p>
      {explanation && (
        <p className="mt-3 rounded border border-accent/25 bg-accent-soft px-3 py-2 text-[12px] leading-relaxed text-ink-mid">
          {explanation.headline}
        </p>
      )}

      {explanation?.clubbing && (
        <dl className="mt-2 flex flex-col gap-1 rounded border border-rule-soft px-3 py-2">
          {[
            ["As one block", `${explanation.clubbing.actual_detention} min`],
            [
              `As ${explanation.clubbing.separate_blocks} blocks`,
              `${explanation.clubbing.separate_detention} min`,
            ],
            [
              "Overheads avoided",
              `${explanation.clubbing.overheads_saved} min-equiv`,
            ],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="text-[11.5px] text-ink-mut">{k}</dt>
              <dd className="tnum font-mono text-[11.5px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <ul className="mt-3 flex flex-col gap-1.5 border-t border-rule-soft pt-3">
        {block.tasks.map((t) => (
          <li key={t.id} className="text-[12px] leading-snug">
            <span className="font-mono text-ink">{t.id}</span>{" "}
            <span className="text-ink-mut">crit-{t.criticality}</span>
            <br />
            <span className="text-ink-mid">{t.activity}</span>{" "}
            <span className="tnum font-mono text-ink-faint">km {t.km}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
