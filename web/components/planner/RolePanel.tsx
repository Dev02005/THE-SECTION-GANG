"use client";

import { DEPT_LABEL, type PlanPayload } from "@/lib/plan";
import { TOTAL_DIVISIONS, TOTAL_ZONES } from "@/lib/railways";
import { type Role, departmentSummary } from "@/lib/roles";
import { useDivisions } from "@/lib/useDivisions";
import { asRole, useSession } from "@/lib/session";

/**
 * The plan read from one officer's seat.
 *
 * The clubbing argument is usually told from above - 42 blocks became 19. This
 * tells it from below, which is the version that decides whether a Sr.DEN
 * supports the idea: more of your work gets done, and a good share of it rides
 * in a block another department was taking anyway.
 *
 * Everything here is derived from the same artefact the rest of the page reads.
 * Nothing is stored against a user and nothing is invented.
 */
export function RolePanel({ plan }: { plan: PlanPayload }) {
  const { session, ready } = useSession();
  const role = asRole(session);

  if (!ready || role === null) return null;
  //  A zonal officer does not schedule blocks; they allocate the machines that
  //  make scheduling possible. Different question, different panel.
  if (role.level === "zone") return <ZonePanel role={role} />;
  //  Every division below resolves to real posts, and only Waltair has been
  //  solved. Showing Waltair's numbers under Bhusaval's name would be exactly
  //  the manufactured result we criticise in the field.
  if (!role.hasPlan) return <NoPlanPanel role={role} />;
  if (role.department === null) return null;

  const s = departmentSummary(plan, role.department);
  const gained = s.scheduled - s.scheduledBaseline;

  return (
    <section
      aria-label={`${DEPT_LABEL[s.department]} view`}
      className="rounded-lg border border-accent bg-accent-soft p-4"
    >
      <p className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-mut">
          Your register
        </span>
        <span className="font-display text-[15px] font-bold text-ink">
          {role.designation} · {DEPT_LABEL[s.department]}
        </span>
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
        <Stat label="Tasks in register" value={String(s.total)} />
        <Stat
          label="Done this horizon"
          value={`${s.scheduled} / ${s.total}`}
          note={
            gained === 0
              ? "same as current practice"
              : `was ${s.scheduledBaseline} / ${s.total}`
          }
        />
        <Stat
          label="Blocks carrying your work"
          value={String(s.blocks)}
          note={`${s.sharedBlocks} shared with another dept`}
        />
        <Stat
          label="Statutory closed"
          value={`${s.statutoryDone} / ${s.statutoryTotal}`}
          note={
            s.statutoryDone === s.statutoryBaseline
              ? "unchanged"
              : `was ${s.statutoryBaseline} / ${s.statutoryTotal}`
          }
        />
      </dl>

      {/*
        A department can lose throughput here, and Engineering does. Saying
        "-10" and stopping would be the same selective arithmetic we criticise
        in the field - so the trade is stated in full: what was kept, what was
        given up, and what the division bought with it.
      */}
      {gained < 0 && (
        <p className="mt-3 border-t border-rule-soft pt-2.5 text-[13px] leading-relaxed text-ink-mid">
          <strong className="text-ink">
            You do {-gained} fewer {-gained === 1 ? "job" : "jobs"} than under
            current practice.
          </strong>{" "}
          {s.statutoryDone >= s.statutoryBaseline ? (
            <>
              {-gained === 1 ? "It is" : "Every one of them is"} deferrable — all {s.statutoryTotal} of your
              statutory items are still closed. Current practice gives this
              corridor to whichever department reaches it first, and yours is
              the largest register, so it takes most of the capacity. Division
              statutory goes {plan.kpis.deltas.statutory_before} →{" "}
              {plan.kpis.deltas.statutory_after} once it is shared.
            </>
          ) : (
            <>
              This includes statutory work, which the shortfall list names with
              its binding constraint.
            </>
          )}
        </p>
      )}

      {s.sharedBlocks > 0 && (
        <p className="mt-3 border-t border-rule-soft pt-2.5 text-[13px] leading-relaxed text-ink-mid">
          <strong className="text-ink">{s.sharedBlocks}</strong> of your{" "}
          {s.blocks} blocks carry another department&rsquo;s work at the same
          time. Under current practice each of those would have been a separate
          block, with its own protection, its own caution order and its own
          detained trains.
        </p>
      )}

      {s.deferred > 0 && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-mut">
          Not placed this horizon:{" "}
          <span className="font-mono">{s.deferredIds.join(" · ")}</span>
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-mut">
        {label}
      </dt>
      <dd className="tnum mt-0.5 font-display text-[19px] font-bold leading-none text-ink">
        {value}
      </dd>
      {note !== undefined && (
        <dd className="mt-1 text-[11.5px] leading-tight text-ink-mid">{note}</dd>
      )}
    </div>
  );
}

/**
 * What a zonal officer sees.
 *
 * A zone does not pick 01:00 on Thursday - it decides which division holds the
 * tamper this season. That allocation is what makes the divisions independent
 * of each other, and it is the reason the zone is the right boundary to split
 * this problem on while the section is not: one tower wagon couples every
 * section inside a division, so a section-by-section solve double-books it.
 */
function ZonePanel({ role }: { role: Role }) {
  //  This once read the generated roles file, so the "plans held here" figure
  //  was a property of a constant rather than of the database - it could not
  //  have been wrong even if the two disagreed. It comes from `my_divisions`
  //  now, scoped to this zone like everything else.
  const { rows, live, error } = useDivisions();
  const held = rows.filter((r) => r.plan_id !== null);

  return (
    <section
      aria-label="Zonal view"
      className="rounded-lg border border-accent bg-accent-soft p-4"
    >
      <p className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-mut">
          Zonal view
        </span>
        <span className="font-display text-[15px] font-bold text-ink">
          {role.designation} · {role.zone.name}
        </span>
        <span className="font-mono text-[11px] text-ink-mut">
          {role.zone.hq} · est. {role.zone.year}
        </span>
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
        <Stat
          label="Divisions in zone"
          value={String(live ? rows.length : role.zone.divisions.length)}
          note={"of " + TOTAL_DIVISIONS + " nationally"}
        />
        <Stat
          label="Plans held here"
          value={
            live
              ? held.length + " / " + rows.length
              : "—"
          }
          note={
            //  Three different reasons for an empty list, and saying the wrong
            //  one is how a missing migration gets mistaken for a zone that
            //  genuinely holds nothing.
            error !== null
              ? "the zone could not be read — " + error
              : !live
                ? "no database configured"
                : held.length > 0
                  ? held.map((d) => d.division_name).join(", ")
                  : "none in this zone"
          }
        />
        <Stat label="Zones" value={String(TOTAL_ZONES)} note="Ministry list" />
        <Stat label="Posts at this level" value="5" note="GM + four PHODs" />
      </dl>

      <p className="mt-3 border-t border-rule-soft pt-2.5 text-[13px] leading-relaxed text-ink-mid">
        A zone allocates; a division schedules. The scarce machines below this
        plan — one tamper, one tower wagon, two USFD units — are zonal assets,
        and the shortfall list is what a DRM brings to this office to ask for
        more of them.{" "}
        <strong className="text-ink">
          The plan on this page is {role.zone.divisions.length > 0 ? "one" : "no"}{" "}
          division of {TOTAL_DIVISIONS}.
        </strong>
      </p>
    </section>
  );
}

/** A real post in a division this instance has not solved. */
function NoPlanPanel({ role }: { role: Role }) {
  return (
    <section
      aria-label="No plan for this division"
      className="rounded-lg border border-rule bg-surface-sunk p-4"
    >
      <p className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-mut">
          No plan held
        </span>
        <span className="font-display text-[15px] font-bold text-ink">
          {role.designation} · {role.division?.name}
        </span>
        <span className="font-mono text-[11px] text-ink-mut">
          {role.zone.code}
        </span>
      </p>
      <p className="text-[13px] leading-relaxed text-ink-mid">
        This is a real post, and this instance holds no plan for{" "}
        {role.division?.name}. The plan below is{" "}
        <strong className="text-ink">Waltair</strong> — one division of{" "}
        {TOTAL_DIVISIONS} — and it stays labelled as Waltair rather than being
        relabelled with your division&rsquo;s name. Solving yours needs its
        corridor policy, its register and its traffic, none of which we hold.
      </p>
    </section>
  );
}
