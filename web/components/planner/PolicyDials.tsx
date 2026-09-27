import type { PlanPayload } from "@/lib/plan";

const DIALS = [
  { key: "alpha_risk", label: "Risk", hint: "Raise after the monsoon" },
  { key: "alpha_detention", label: "Detention", hint: "Raise before a festival rush" },
  { key: "alpha_fixed", label: "Block cost", hint: "Overhead of granting any block" },
  { key: "alpha_club", label: "Clubbing", hint: "Reward per extra department" },
] as const;

/** The top of the drawn scale. Every shipped weight sits well inside it. */
const SCALE_MAX = 3;

/**
 * The four policy weights the displayed plan was solved with.
 *
 * READ-ONLY, deliberately. These used to be sliders that moved and re-solved
 * nothing, and once moved they promised that "live re-planning lands in the
 * next stage" - a stage that was never going to exist, because there is no
 * server to re-solve on. A dial that changes and a plan that does not is worse
 * than no dial.
 *
 * What turning the risk dial actually does is measured, one panel down: the
 * trade-off curve is seven real re-solves across that weight. That is the
 * honest version of a slider, and it is where this panel points.
 */
export function PolicyDials({ weights }: { weights: PlanPayload["weights"] }) {
  return (
    <section className="rounded-lg border border-rule bg-surface p-4">
      <h3 className="eyebrow mb-3">Policy weights</h3>
      <dl className="flex flex-col gap-3">
        {DIALS.map((d) => (
          <div key={d.key}>
            <div className="mb-1 flex items-baseline justify-between">
              <dt className="text-[12.5px] text-ink-mid">{d.label}</dt>
              <dd className="tnum font-mono text-[12px] text-ink">
                {weights[d.key].toFixed(1)}
              </dd>
            </div>
            <div aria-hidden="true" className="h-1.5 w-full rounded-full bg-surface-sunk">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, (weights[d.key] / SCALE_MAX) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-ink-mut">{d.hint}</p>
          </div>
        ))}
      </dl>

      <p className="mt-3 border-t border-rule-soft pt-3 text-[11.5px] leading-relaxed text-ink-mut">
        The weights this plan was solved with; every plan records them. Nothing
        re-solves in the browser. What turning the risk weight does is measured
        in the trade-off curve below, from seven real re-solves.
      </p>
    </section>
  );
}
