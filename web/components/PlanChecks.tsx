"use client";

import { type ChecksState, type DbChecksState, checksMatch } from "@/lib/checks";
import type { DbRule } from "@/lib/db";
import type { PlanPayload } from "@/lib/plan";

/**
 * The pre-approval checks, beside the fingerprint on every plan page.
 *
 * Collapsed to one line - how many pass, and that they were run on the
 * published plan independently of the solver - with every check one click
 * away. A check with nothing to examine says so ("none to check") rather than
 * wearing a pass it did not earn.
 *
 * Two sources, kept visibly apart. The ENGINE's twelve run on the artefact.
 * The DATABASE re-runs the nine its own rows can answer, at the moment of
 * submission and of approval, and requires the engine's record for the rest.
 * The second is what makes the hold real: the buttons below are a courtesy,
 * the database's refusal is not.
 */
export function PlanChecks({
  plan,
  s,
  db,
}: {
  plan: PlanPayload;
  s: ChecksState;
  db: DbChecksState;
}) {
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
  const dbRules = db.state === "ready" ? db.checks.rules : [];
  const dbPassing = dbRules.filter((r) => r.passed).length;
  const dbFails = db.state === "ready" && !db.checks.passed;
  const ok = c.passed && !dbFails;

  return (
    <details
      className={`${shell} ${ok ? "border-rule bg-surface" : "border-danger bg-danger-soft"}`}
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
        {db.state === "ready" && (
          <>
            {" "}
            <span className="text-ink-mut">·</span>{" "}
            <strong className={db.checks.passed ? "text-go" : "text-danger"}>
              database re-ran {dbPassing} of {dbRules.length}
            </strong>
          </>
        )}
      </summary>

      <Rules rules={c.checks} />
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-mut">
        The model&rsquo;s own rules, named the way a division says them &mdash;
        not citations of the General and Subsidiary Rules. A plan that fails
        any of them is never issued.
      </p>

      <DbPart db={db} />
    </details>
  );
}

function Rules({ rules }: { rules: DbRule[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {rules.map((x) => (
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
  );
}

/** What the database will do when someone presses Submit or Approve. */
function DbPart({ db }: { db: DbChecksState }) {
  const head = (
    <p className="mt-3 border-t border-rule-soft pt-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-mut">
      Enforced by the database
    </p>
  );
  if (db.state === "none" || db.state === "loading") return null;
  if (db.state === "unavailable") {
    return (
      <>
        {head}
        <p className="mt-1 text-[12px] leading-relaxed text-ink">
          This database does not re-check the plan yet &mdash; migration{" "}
          <code className="font-mono">0012_plan_checks.sql</code> is not
          applied &mdash; so the hold on Submit and Approve is the page&rsquo;s
          alone.
        </p>
      </>
    );
  }
  const e = db.checks.engine;
  return (
    <>
      {head}
      <p className="mt-1 text-[12px] leading-relaxed text-ink-mid">
        Re-run in SQL over the rows the database holds, every time the plan is
        submitted or approved &mdash; not copied from the engine&rsquo;s answer.
        A plan that fails is refused by the database, whatever this page shows.
      </p>
      <Rules rules={db.checks.rules} />
      <p className="mt-2 text-[12px] leading-relaxed text-ink">
        <span
          className={`font-mono text-[11px] font-bold ${e.passed && e.belongs ? "text-go" : "text-danger"}`}
        >
          {e.passed && e.belongs ? "PASS" : "FAIL"}
        </span>{" "}
        {!e.present
          ? "No engine check record is stored with this plan."
          : !e.belongs
            ? "The engine's record stored here is of a different build."
            : e.passed
              ? `The engine's ${e.checks} checks, required for what the database does not hold — machine and gang counts, due dates, booked durations, blackout days.`
              : `The engine's record fails: ${e.failing.join(", ")}.`}
      </p>
    </>
  );
}
