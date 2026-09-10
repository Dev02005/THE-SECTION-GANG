"use client";

import type { DbDivisionRow } from "@/lib/db";
import type { Role } from "@/lib/roles";

/**
 * What a division without a solved plan gets instead.
 *
 * It used to be one sentence on an otherwise empty page, which read as a
 * failure rather than as an answer. There IS something true to show here: the
 * division is real, its zone and headquarters and year of creation come from
 * the Ministry's published list, and the reason it has no plan is a specific,
 * nameable shortage of four inputs rather than a shrug.
 *
 * What it must never do is fill the space with Waltair's numbers under this
 * division's name. Four of the seven competing submissions publish figures
 * their own code manufactured; the empty state is where that temptation is
 * strongest, so it is where the refusal has to be most deliberate.
 */
export function NoPlanPanel({
  role,
  divisionName,
  rows,
}: {
  role: Role | null;
  /** The division actually asked for - a zonal post has none of its own. */
  divisionName: string | null;
  rows: DbDivisionRow[];
}) {
  const zone = role?.zone ?? null;
  const name = divisionName ?? role?.division?.name ?? null;
  const held = rows.filter((r) => r.plan_id !== null);

  return (
    <div className="signal-rule py-8">
      <p className="eyebrow mb-2">No plan held</p>
      <h2 className="mb-3 text-[21px] font-bold">
        {name !== null
          ? `${name} has no solved plan in this instance`
          : `No solved plan for this post`}
      </h2>

      {/*  Real reference data, and the only real data we have about this
           division: the Ministry list. Shown because a page that knows the
           division exists should say so.  */}
      <dl className="mb-5 grid max-w-[640px] grid-cols-2 gap-x-6 gap-y-2 border-y border-rule-soft py-3 text-[13px] sm:grid-cols-4">
        {name !== null && <Fact k="Division" v={name} />}
        {zone !== null && <Fact k="Zone" v={`${zone.name} (${zone.code})`} />}
        {zone !== null && <Fact k="Headquarters" v={zone.hq} />}
        {zone !== null && <Fact k="Zone formed" v={String(zone.year)} />}
      </dl>

      <p className="mb-3 max-w-[70ch] text-[15px] leading-relaxed text-ink-mid">
        The post is real and so is the division — both come from the Ministry of
        Railways list of zones and divisions, which is the one piece of real
        reference data in this application. What is missing is a{" "}
        <strong className="text-ink">solve</strong>, and a solve needs four
        things from this division that we do not have:
      </p>

      <ul className="mb-4 grid max-w-[760px] gap-2 sm:grid-cols-2">
        {[
          ["The defect register", "What is broken, where along the line, and how overdue. Lives in TMS, SMMS and TDMS — internal, no external access."],
          ["Corridor policy", "Which hours this division is willing to give up, and on which sections. Held in COA."],
          ["The working timetable", "Which trains a block would hold up, hour by hour, so the cost of closing the line can be priced."],
          ["The machine roster", "How many tampers, tower wagons and USFD units this division actually has. It is the binding constraint almost everywhere."],
        ].map(([h, p]) => (
          <li key={h} className="border-l-2 border-rule pl-3">
            <strong className="text-[13.5px] text-ink">{h}</strong>
            <br />
            <span className="text-[12.5px] leading-relaxed text-ink-mut">
              {p}
            </span>
          </li>
        ))}
      </ul>

      <p className="max-w-[70ch] text-[14px] leading-relaxed text-ink-mid">
        <strong className="text-ink">Waltair is solved</strong> because those
        gaps could be closed from public sources for that one corridor: five
        real stations with published coordinates, the real passenger timetable,
        and four real premium services the plan is drawn around. Its defect
        register is still generated, and every page says so.
        {held.length > 0 && zone !== null && (
          <>
            {" "}
            In {zone.name}, {held.length} of {rows.length}{" "}
            {rows.length === 1 ? "division holds" : "divisions hold"} a plan.
          </>
        )}
      </p>

      <p className="mt-3 max-w-[70ch] text-[14px] leading-relaxed text-ink-mut">
        You are reading this rather than Waltair&rsquo;s numbers with{" "}
        {name ?? "this division"} written on top of them — which would be easy,
        would look far better, and is the failure this system exists to refuse.
      </p>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mut">
        {k}
      </dt>
      <dd className="mt-0.5 text-ink">{v}</dd>
    </div>
  );
}
