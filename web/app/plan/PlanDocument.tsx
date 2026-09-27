"use client";

import { PlanFingerprint } from "@/components/PlanFingerprint";
import { DAY_NAMES, DEPT_LABEL, num, planReference } from "@/lib/plan";
import type { PlanBlock, PlanPayload } from "@/lib/plan";
import { ScopedPlan } from "@/components/ScopedPlan";
import { PrintButton } from "./PrintButton";

/**
 * The plan as a document, drawn from whichever plan this post is entitled to.
 *
 * It became a client component when the plan stopped being a file. Nothing
 * about the document changed - the markup below is what it always was - but the
 * source did: `ScopedPlan` asks Postgres which plan this officer may see, and a
 * division with none gets a panel saying so rather than an issuable document
 * carrying another division's corridor.
 *
 * That matters more here than anywhere else in the application. This page is
 * meant to be printed and carried into a block meeting; a printed document is
 * quoted long after the screen that produced it is forgotten.
 */
export function PlanGate({ fallback }: { fallback: PlanPayload }) {
  return (
    <ScopedPlan fallback={fallback}>
      {(plan) => <PlanDocument plan={plan} />}
    </ScopedPlan>
  );
}

function PlanDocument({ plan }: { plan: PlanPayload }) {
  const byDay = new Map<number, PlanBlock[]>();
  for (const b of plan.optimised.blocks) {
    byDay.set(b.day, [...(byDay.get(b.day) ?? []), b]);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const generated = new Date(plan.generatedAt);

  return (
    <>
    <PrintButton />

    {/* masthead */}
    <header className="border-b-2 border-ink pb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mut">
          Ministry of Railways · Divisional Engineering
        </p>
        <p className="font-mono text-[10px] text-ink-mut">
          Plan ref{" "}
          {/*  The same string the database row carries. It was built here in
               a different format - dashes stripped - so the reference on the
               printed document did not match the record it referred to.  */}
          <span className="text-ink">{planReference(plan)}</span>
        </p>
      </div>
      <h1 className="mt-2 font-display text-[30px] font-bold leading-none">
        Weekly maintenance block plan
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-mid">
        {plan.sections[0]?.name.split("–")[0]?.trim()} –{" "}
        {plan.sections[plan.sections.length - 1]?.name.split("–")[1]?.trim()}{" "}
        · {plan.sections.length} block sections · double line, electrified ·{" "}
        {plan.horizon.days}-day horizon
      </p>
    </header>

    {/* summary bar */}
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 border-b border-rule py-3 text-[12px] sm:grid-cols-4">
      {[
        ["Blocks proposed", String(plan.kpis.optimised.blocks)],
        ["Block-hours", plan.kpis.optimised.block_hours.toFixed(1)],
        [
          "Statutory",
          `${plan.kpis.optimised.statutory_done}/${plan.kpis.optimised.statutory_total}`,
        ],
        ["Multi-department", `${plan.kpis.optimised.multidept_pct}%`],
      ].map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-mut">{k}</dt>
          <dd className="tnum font-mono font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>

    {/* the plan, day by day */}
    {days.map((day) => (
      <section key={day} className="mt-5 break-inside-avoid">
        <h2 className="mb-1.5 border-b border-rule pb-1 font-display text-[15px] font-bold uppercase tracking-wide">
          {DAY_NAMES[day % 7]} — day {day + 1}
        </h2>
        <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[620px] border-collapse text-[11.5px] print:min-w-0">
          <thead>
            <tr className="border-b border-rule">
              {[
                "Block ref",
                "Section",
                "Scope",
                "From",
                "To",
                "Min",
                "Detn",
                "Work",
              ].map((h, i) => (
                <th
                  key={h}
                  className={`py-1 font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-ink-mut ${
                    i >= 3 && i <= 6 ? "text-right" : "text-left"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(byDay.get(day) ?? [])
              .sort((a, b) => a.startSlot - b.startSlot)
              .map((b) => (
                <tr
                  key={b.id}
                  className="border-b border-rule-soft align-top break-inside-avoid"
                >
                  <td className="py-1.5 pr-2 font-mono text-[10px] text-ink-mut">
                    {b.id.replace(/^W-/, "")}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{b.section}</td>
                  <td className="py-1.5 pr-2">
                    {b.scope === "SECTION" ? (
                      <span className="font-medium">
                        SECTION
                        <span className="text-ink-mut"> (both roads)</span>
                      </span>
                    ) : (
                      `${b.scope} road`
                    )}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right font-mono">
                    {b.startHHMM}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right font-mono">
                    {b.endHHMM}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right font-mono">
                    {b.durationMin}
                  </td>
                  <td className="tnum py-1.5 pr-3 text-right font-mono text-ink-mut">
                    {b.detentionMinutes}
                  </td>
                  <td className="py-1.5">
                    <ul className="flex flex-col gap-0.5">
                      {b.tasks.map((t) => (
                        <li key={t.id}>
                          <span className="font-mono text-[10px] text-ink-mut">
                            {t.id}
                          </span>{" "}
                          <span className="font-medium">
                            {DEPT_LABEL[t.department]}
                          </span>{" "}
                          {t.activity}{" "}
                          <span className="tnum font-mono text-[10px] text-ink-mut">
                            km {t.km}
                          </span>
                          {t.criticality === "A" && (
                            <span className="ml-1 font-mono text-[9px] font-medium text-danger">
                              STAT
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        </div>
      </section>
    ))}

    {/* shortfall */}
    {plan.shortfall.length > 0 && (
      <section className="mt-6 break-inside-avoid border border-danger/40 p-3">
        <h2 className="mb-1 font-display text-[14px] font-bold uppercase tracking-wide text-danger">
          Statutory work not accommodated
        </h2>
        <p className="mb-2 text-[11px] leading-relaxed text-ink-mid">
          The following criticality-A items cannot be placed within the
          corridor budget for this horizon. Each is listed with the constraint
          that bound it. This list is the evidence for a request for
          additional block time.
        </p>
        <table className="w-full border-collapse text-[11.5px]">
          <tbody>
            {plan.shortfall.map((s) => (
              <tr key={s.taskId} className="border-t border-rule-soft">
                <td className="py-1 pr-3 font-mono text-[10.5px]">
                  {s.taskId}
                </td>
                <td className="tnum py-1 pr-3 font-mono text-ink-mut">
                  ρ {s.riskRate}/slot
                </td>
                <td className="py-1 text-ink-mid">{s.bindingConstraint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    )}

    {/* approval */}
    <section className="mt-8 break-inside-avoid border-t-2 border-ink pt-4">
      <p className="mb-4 text-[11px] leading-relaxed text-ink-mid">
        <strong className="text-ink">This is a proposal, not a grant.</strong>{" "}
        It is placed before the divisional block meeting for review and
        amendment. BDMS remains the system of record; blocks are granted
        through the existing approval workflow, which this plan does not
        bypass. No output of this system is safety-critical in the
        interlocking sense.
      </p>
      <div className="grid grid-cols-3 gap-6">
        {["Sr. DEN", "Sr. DSTE", "Sr. DEE (TRD)"].map((role) => (
          <div key={role}>
            <div className="h-10 border-b border-ink" />
            <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-mut">
              {role}
            </p>
          </div>
        ))}
      </div>
    </section>

    {/* provenance */}
    <footer className="mt-6 border-t border-rule pt-3 font-mono text-[9.5px] leading-relaxed text-ink-mut">
      Generated {generated.toUTCString()} · seed {plan.provenance.seed} ·
      models {Object.entries(plan.provenance.modelVersions ?? {})
        .map(([k, v]) => `${k}@${v}`)
        .join(" ")}
      <br />
      Solver {plan.solver.status}, deterministic{" "}
      {String(plan.solver.deterministic)}, objective{" "}
      {num(plan.solver.objective)}, proven floor{" "}
      {num((plan.placement?.bound ?? plan.solver.bound ?? 0))}.
      <br />
      <PlanFingerprint plan={plan} variant="document" />
      <br />
      <strong className="text-ink">
        Maintenance backlog is synthetic.
      </strong>{" "}
      TMS, SMMS, TDMS, COA and BDMS have no external access; the defect
      register shown here is generated, not observed. Corridor geometry, train
      traffic and protected paths are measured from published data.
    </footer>
    </>
  );
}
