"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlanPayload } from "@/lib/plan";
import { type ReplanSet, replanMatches } from "@/lib/replan";
import type { ChartRow } from "@/components/planner/TimeDistanceChart";
import { ScenarioView } from "@/components/replan/ScenarioView";

/**
 * Pick a disruption, and see what the plan does about it.
 *
 * Eight disruptions, precomputed against the approved week by the same
 * replanner - a rail flaw, an S&T failure, an OHE fault that needs the one
 * tower wagon - on different sections, days and deadlines. None is tuned, and
 * one that cannot be met by its deadline is shown as exactly that.
 *
 * The choice is kept in the address (`?s=`), so a scenario can be linked to.
 * Every figure is read from replan.json, which the engine wrote after checking
 * it was replanning the week that actually shipped.
 */
export function ReplanView({
  plan,
  replan,
}: {
  plan: PlanPayload;
  replan: ReplanSet | null;
}) {
  const rows: ChartRow[] = useMemo(
    () => plan.sections.flatMap((s) => plan.roads.map((road) => ({ section: s.id, road }))),
    [plan],
  );
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    setPicked(new URLSearchParams(window.location.search).get("s"));
  }, []);

  if (replan === null) {
    return (
      <Note>
        No replans have been built for this plan. They are produced offline by{" "}
        <code className="font-mono">python -m engine.build_replan</code>.
      </Note>
    );
  }
  if (!replanMatches(replan, plan)) {
    return (
      <Note>
        The precomputed disruptions belong to a different plan from the one you
        are looking at, so they are not shown. A disruption response only means
        something against the week it was computed for.
      </Note>
    );
  }

  const current =
    replan.scenarios.find((s) => s.id === picked) ??
    replan.scenarios.find((s) => s.id === replan.featured) ??
    replan.scenarios[0];

  function pick(id: string) {
    setPicked(id);
    const url = new URL(window.location.href);
    url.searchParams.set("s", id);
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="eyebrow mb-1.5">
          Precomputed · {replan.scenarios.length} disruptions to choose from
        </p>
        <h1 className="text-[26px] font-bold">When the week does not go to plan</h1>
        <p className="mt-2 max-w-[86ch] text-[14px] leading-relaxed text-ink-mid">
          Pick a disruption. Each was re-solved against the approved week by the
          same replanner &mdash; nothing tuned &mdash; and each says what it cost
          and which one extra resource would have avoided the cost.
        </p>
      </header>

      <nav aria-label="Choose a disruption" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {replan.scenarios.map((s) => {
          const on = s.id === current.id;
          const [what, ...rest] = s.title.split(" · ");
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              onClick={() => pick(s.id)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                on
                  ? "border-accent bg-accent-soft"
                  : "border-rule bg-surface hover:border-ink-mut"
              }`}
            >
              <span className="block text-[13px] font-bold text-ink">{what}</span>
              <span className="block font-mono text-[11px] text-ink-mut">
                {rest.join(" · ")}
              </span>
              <span
                className={`mt-0.5 block text-[11px] ${s.feasible ? "text-ink-mut" : "font-bold text-danger"}`}
              >
                {s.feasible
                  ? `${s.lost.length} statutory lost · ${s.result.minChanges ?? 0} changed`
                  : "cannot be met by its deadline"}
              </span>
            </button>
          );
        })}
      </nav>

      <ScenarioView
        key={current.id}
        plan={plan}
        sc={current}
        rows={rows}
        blackoutDays={replan.blackoutDays}
      />
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-[70ch] rounded-lg border border-rule px-4 py-3 text-[13.5px] leading-relaxed text-ink-mid">
      {children}
    </p>
  );
}
