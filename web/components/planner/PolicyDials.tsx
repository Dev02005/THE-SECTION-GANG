"use client";

import { useState } from "react";
import type { PlanPayload } from "@/lib/plan";

const DIALS = [
  { key: "alpha_risk", label: "Risk", hint: "Raise after the monsoon" },
  { key: "alpha_detention", label: "Detention", hint: "Raise before a festival rush" },
  { key: "alpha_fixed", label: "Block cost", hint: "Overhead of granting any block" },
  { key: "alpha_club", label: "Clubbing", hint: "Reward per extra department" },
] as const;

/**
 * The four policy weights, as a Sr.DEN would turn them.
 *
 * These are shown at the values the displayed plan was actually solved with -
 * moving them without re-solving would show a plan that does not correspond to
 * the dials, which is worse than not having dials. The live re-solve lands in
 * T7; until then they are read-only and say so.
 */
export function PolicyDials({ weights }: { weights: PlanPayload["weights"] }) {
  const [values, setValues] = useState(weights);
  const dirty = DIALS.some((d) => values[d.key] !== weights[d.key]);

  return (
    <section className="rounded-lg border border-rule bg-surface p-4">
      <h3 className="eyebrow mb-3">Policy dials</h3>
      <div className="flex flex-col gap-3">
        {DIALS.map((d) => (
          <label key={d.key} className="block">
            <span className="mb-1 flex items-baseline justify-between">
              <span className="text-[12.5px] text-ink-mid">{d.label}</span>
              <span className="tnum font-mono text-[12px] text-ink">
                {values[d.key].toFixed(1)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={values[d.key]}
              aria-label={`${d.label} weight`}
              onChange={(e) =>
                setValues({ ...values, [d.key]: Number(e.target.value) })
              }
              className="w-full accent-[var(--accent)]"
            />
            <span className="text-[11px] text-ink-mut">{d.hint}</span>
          </label>
        ))}
      </div>

      <p className="mt-3 border-t border-rule-soft pt-3 text-[11.5px] leading-relaxed text-ink-mut">
        {dirty ? (
          <span className="text-caution">
            Moved from the values this plan was solved with. The chart still
            shows the original solve — live re-planning lands in the next stage.
          </span>
        ) : (
          "These are the weights the displayed plan was solved with. Every plan records them."
        )}
      </p>
    </section>
  );
}
