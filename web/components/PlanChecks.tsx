"use client";

import { type ChecksState, checksMatch } from "@/lib/checks";
import type { PlanPayload } from "@/lib/plan";

/**
 * The pre-approval checks, beside the fingerprint on every plan page.
 *
 * Collapsed to one line - how many pass, and that they were run on the
 * published plan independently of the solver - with every check one click
 * away. A check with nothing to examine says so ("none to check") rather than
 * wearing a pass it did not earn.
 */
export function PlanChecks({ plan, s }: { plan: PlanPayload; s: ChecksState }) {
  if (s.state === "loading") return null;

  const shell = "mb-5 rounded-lg border px-3 py-2.5 text-[12.5px] print:hidden";
  if (s.state === "missing") {
    return (
      <p className={`${shell} border-caution bg-caution-soft text-ink`}>
        <strong>Pre-approval checks not found.</strong> This plan cannot be
        submitted or approved until they are run:{" "}
        <code className="font-mono">python -m engine.build_checks</code>.
      </p>
    );
  }
  const c = s.checks;
  if (!checksMatch(c, plan)) {
    return (
      <p className={`${shell} border-caution bg-caution-soft text-ink`}>
        <strong>Pre-approval checks are for a different build</strong> of this
        plan, so they say nothing about this one. It cannot be submitted or
        approved until they are re-run.
      </p>
    );
  }

  const passing = c.checks.filter((x) => x.passed).length;
  return (
    <details
      className={`${shell} ${c.passed ? "border-rule bg-surface" : "border-danger bg-danger-soft"}`}
    >
      <summary className="cursor-pointer select-none text-ink">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-mut">
          Pre-approval checks
        </span>{" "}
        <strong className={c.passed ? "text-go" : "text-danger"}>
          {passing} of {c.checks.length} pass
        </strong>
        <span className="text-ink-mut">
          {" "}
          · run on the published plan, independently of the solver
        </span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {c.checks.map((x) => (
          <li key={x.id} className="flex flex-wrap items-baseline gap-x-2 leading-snug">
            <span
              className={`font-mono text-[11px] font-bold ${x.passed ? "text-go" : "text-danger"}`}
            >
              {x.passed ? "PASS" : "FAIL"}
            </span>
            <span className="text-ink">{x.name}</span>
            <span className="tnum font-mono text-[11px] text-ink-mut">
              {x.examined === 0 ? "none to check" : `${x.examined} examined`}
            </span>
            {x.failures.length > 0 && (
              <span className="w-full pl-10 text-[11.5px] text-danger">
                {x.failures.join(" · ")}
                {x.failed > x.failures.length ? ` · and ${x.failed - x.failures.length} more` : ""}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-mut">
        The model&rsquo;s own rules, named the way a division says them &mdash;
        not citations of the General and Subsidiary Rules. A plan that fails
        any of them is never issued.
      </p>
    </details>
  );
}
