"use client";

import { num, type PlanPayload } from "@/lib/plan";
import { type MonthlyPayload, monthlyMatches } from "@/lib/monthly";
import { MonthGrid, ResourceTable } from "@/components/monthly/MonthTables";

/**
 * The month: which week each job goes in, and whether week 1 holds up.
 *
 * Read top to bottom the way a division would ask. How much of the month's
 * work fits, and is every statutory job in it? Where does the corridor run
 * out, and which machine is the bottleneck? Then the question a monthly plan
 * is usually spared: when week 1 is scheduled to the minute, how much of what
 * the month promised actually fits - and where does the rest go?
 *
 * Every figure is read from monthly.json, which the engine wrote from three
 * real solves: the month, week 1 at full resolution, and weeks 2-4 re-planned.
 */
export function MonthlyView({ plan, m }: { plan: PlanPayload; m: MonthlyPayload | null }) {
  if (m === null) {
    return (
      <Note>
        No monthly plan has been built. It is produced offline by{" "}
        <code className="font-mono">python -m engine.build_monthly</code>.
      </Note>
    );
  }
  if (!monthlyMatches(m, plan)) {
    return (
      <Note>
        The monthly plan was built from a different week&rsquo;s backlog than the
        plan you are looking at, so it is not shown. A month only means something
        beside the week it starts from.
      </Note>
    );
  }

  const t = m.totals;
  const h = m.handoff;
  const priced = m.deferred.filter((d) => d.reason.startsWith("priced")).length;
  const noRoom = m.deferred.filter((d) => d.reason.startsWith("no room")).length;
  const fitPct = h.allocated ? Math.round((100 * h.scheduled) / h.allocated) : 0;
  //  The month places every statutory job inside its due date; week 1 at full
  //  resolution may not. Say so on the card, not only further down the page.
  const slipped = h.misses.filter((x) => x.criticality === "A").length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="eyebrow mb-1.5">Monthly horizon · {m.horizon.weeks} weeks · tactical</p>
        <h1 className="text-[26px] font-bold">The month ahead</h1>
        <p className="mt-2 max-w-[86ch] text-[14px] leading-relaxed text-ink-mid">
          Which week each job goes in, and how much corridor each section needs
          that week. The weekly planner then schedules a week to the minute. The
          month starts from the same backlog as the planner&rsquo;s week &mdash;
          all {t.shippedWeekBacklog} of its jobs, id for id &mdash; plus three
          more weeks of work behind it.
        </p>
      </header>

      <section aria-label="The month in figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Jobs placed" value={`${num(t.placed)} of ${num(t.jobs)}`}
          note={`${t.deferred} deferred: ${priced} priced out, ${noRoom} with no room`} />
        <Stat label="Statutory placed" value={`${t.statutoryPlaced} of ${t.statutoryTotal}`}
          note={slipped
            ? `${slipped} slip when week 1 is scheduled to the minute - below`
            : "every one inside its due date"} />
        <Stat label="Week 1 fits, to the minute" value={`${h.scheduled} of ${h.allocated}`}
          note={`${fitPct}% · measured by the weekly solver, not assumed`} />
        <Stat label="Optimality"
          value={m.solver.gapPct === null ? "—" : `${m.solver.gapPct}%`}
          note="gap to the solver's proven floor" />
      </section>

      <section aria-label="Corridor by section and week">
        <h2 className="eyebrow mb-2">Corridor time by section and week</h2>
        <MonthGrid m={m} />
      </section>

      <section aria-label="Resources by week">
        <h2 className="eyebrow mb-2">Shared machines and crews, by week</h2>
        <ResourceTable m={m} />
      </section>

      <section aria-label="Week 1 handoff" className="rounded-lg border border-rule bg-surface p-4">
        <h2 className="eyebrow mb-2">Week 1, handed to the weekly solver</h2>
        <p className="text-[14px] leading-relaxed text-ink">
          The month gave week 1 <strong>{h.allocated} jobs</strong>. Scheduled to
          the minute &mdash; windows, roads, protection and clearance &mdash; the
          weekly solver placed <strong>{h.scheduled}</strong> of them in{" "}
          {h.blocks} blocks, {h.statutory[0]} of {h.statutory[1]} statutory. The{" "}
          {h.misses.length} it could not place roll forward, and weeks 2&ndash;4
          are re-planned with them: {m.rolled.perWeek.join(" · ")} jobs.
        </p>
        {h.misses.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {h.misses.map((x) => (
              <li key={x.id} className="text-[12.5px] leading-snug text-ink-mid">
                <span className="font-mono text-ink">{x.id}</span>{" "}
                <span className="text-ink-mut">crit-{x.criticality}</span> {x.activity},{" "}
                {x.section} &mdash; {x.binding}
                {x.rolledToWeek !== null ? ` → week ${x.rolledToWeek}` : " → still deferred"}
                {x.overdue ? " (now overdue)" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Deferred" className="rounded-lg border border-rule bg-surface p-4">
        <h2 className="eyebrow mb-2">Not in this month · {t.deferred}</h2>
        <p className="text-[13.5px] leading-relaxed text-ink-mid">
          None of them statutory. <strong>{priced}</strong> are priced out: the risk
          they carry costs less than the corridor time they would need.{" "}
          <strong>{noRoom}</strong> have no room: every week they could use has its
          section&rsquo;s corridor or a machine they need already full. Many are
          not due until after this month.
        </p>
      </section>

      <p className="max-w-[86ch] text-[12.5px] leading-relaxed text-ink-mut">
        The month is coarse by design. It cannot see roads or minutes, so it is
        held to the packing the weekly solver achieves on a full week &mdash;{" "}
        {m.calibration.packing} work-hours per block-hour &mdash; and checked
        against it every week. Risk here is priced over the 28-day horizon, so
        the same job carries a somewhat higher price than in the week&rsquo;s
        plan. Solved offline in {m.solver.wallTimeS} seconds and precomputed.
      </p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-rule bg-surface p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mut">{label}</p>
      <p className="tnum mt-1 text-[20px] font-bold text-ink">{value}</p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-ink-mut">{note}</p>
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
