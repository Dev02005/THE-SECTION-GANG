"use client";

import { type ReactNode, useState } from "react";
import type { PlanPayload } from "@/lib/plan";
import { type PlanState, usePlan } from "@/lib/usePlan";
import { useDivisions } from "@/lib/useDivisions";
import { ZoneDivisions } from "@/components/ZoneDivisions";
import { ApprovalPanel } from "@/components/ApprovalPanel";
import { NoPlanPanel } from "@/components/NoPlanPanel";
import { PlanFingerprint } from "@/components/PlanFingerprint";
import { PlanChecks } from "@/components/PlanChecks";
import { approvalClear, useChecks, useDbChecks } from "@/lib/checks";
import { asRole, useSession } from "@/lib/session";

/**
 * Draw the plan this officer is entitled to, or say plainly that there is none.
 *
 * The page above is still statically rendered and still carries the engine's
 * artefact; this decides whether that artefact is what the viewer should be
 * looking at. Once a database is configured it is not - the plan comes from
 * `my_plan`, scoped in Postgres to the signed-in post, and the static file is
 * only the path for a clone with no credentials.
 *
 * THE EMPTY STATE IS THE POINT. Postgres answers null both for "your division
 * has no plan" and for "that plan belongs to another zone", and it deliberately
 * does not say which: telling an officer of Northern Railway that East Coast
 * holds a plan they may not see is itself a disclosure. So the wording below is
 * built from what the SESSION already knows about its own post, never from what
 * the query declined to answer.
 *
 * A render prop rather than a wrapper component because the two consumers draw
 * completely different things from the same payload - the comparison screen and
 * the issuable document - and neither should have to know how the other gets it.
 *
 * The second argument is the plan ROW - its id and status - for a page that
 * acts on the plan rather than drawing it (the block record). Null on the
 * artefact fallback, which belongs to no division and has no row.
 */
export interface PlanContext {
  record: PlanState["record"];
  refresh: () => void;
}

export function ScopedPlan({
  fallback,
  children,
}: {
  fallback: PlanPayload;
  children: (plan: PlanPayload, ctx: PlanContext) => ReactNode;
}) {
  const { session } = useSession();
  //  Called before any early return, as every hook must be.
  const checks = useChecks();
  const role = asRole(session);
  //  Only a zonal post can move this. A divisional post is pinned to its own
  //  division inside the query, so the state exists but cannot do anything.
  const [division, setDivision] = useState<string | null>(null);
  const { rows } = useDivisions();
  const { plan, source, loading, error, record, refresh } = usePlan(
    fallback,
    division,
  );
  //  What the database itself will find when Submit or Approve is pressed.
  const dbChecks = useDbChecks(record?.id ?? null);

  const zonal = role?.level === "zone";
  const picker =
    zonal && rows.length > 0 ? (
      <ZoneDivisions rows={rows} selected={division} onSelect={setDivision} />
    ) : null;
  //  Whose plan is missing: the division actually asked for, not the post's
  //  own - a GM has no division of their own to name.
  const askedFor =
    rows.find((r) => r.division_code === division)?.division_name ?? null;

  if (loading) {
    return (
      <p className="py-16 text-[15px] text-ink-mid" aria-busy="true">
        Fetching the plan held for your division…
      </p>
    );
  }

  if (error !== null) {
    return (
      <div className="signal-rule py-10">
        <p className="eyebrow mb-2">Database unreachable</p>
        <p className="max-w-[62ch] text-[15px] leading-relaxed text-ink-mid">
          {error}. The plan is held in Postgres and read per officer, so there
          is nothing to show without it. This is the connection, not the plan.
        </p>
      </div>
    );
  }

  //  `== null` catches undefined too. A component that renders whatever it is
  //  handed will dereference undefined and take the page down; the state above
  //  is the one worth being strict about.
  if (plan == null) {
    return (
      <>
        {picker}
        <NoPlanPanel
          role={role}
          //  The division actually asked for, not the post's own - a zonal
          //  officer opening Khurda Road has no division of their own to name.
          divisionName={askedFor}
          rows={rows}
        />
      </>
    );
  }

  return (
    <>
      {picker}
      {/*  Where the plan sits in the chain, and the one action this post can
           take on it. Above the plan because the status changes what the plan
           below it means: a draft is a proposal, an approved plan is a
           programme.  */}
      <ApprovalPanel
        record={record}
        refresh={refresh}
        checksOk={approvalClear(checks, dbChecks, plan)}
      />
      {/*  Recomputed from the plan being drawn and checked against the record.
           No record at all - offline, or the artefact fallback - is passed as
           undefined, which the component states rather than hides.  */}
      <PlanFingerprint
        plan={plan}
        stored={record === null ? undefined : (record.plan_hash ?? null)}
        variant="panel"
      />
      {/*  Re-run on the published plan, independently of the solver. Submit and
           approve above are held unless this set passes and belongs here.  */}
      <PlanChecks plan={plan} s={checks} db={dbChecks} />
      {source !== "database" && (
        <p className="mb-4 rounded border border-caution bg-caution-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink print:hidden">
          {source === "artefact" ? (
            <>
              <strong>Offline demonstration mode.</strong> No database is
              configured for this build, so your sign-in was checked in this
              browser against the published directory and the plan below is
              the engine&rsquo;s file. It is scoped the way the database would
              scope it, but nothing here is enforced — connect Supabase for
              that. The approval chain needs the database and is hidden.
            </>
          ) : source === "artefact-unreachable" ? (
            <>
              <strong>The database could not be reached.</strong> One is
              configured for this build, but the request never arrived — so
              this is the engine&rsquo;s file, scoped the way the database
              would scope it, and not the plan your division currently holds.
              Its real status, and anything another officer has changed, are
              unknown here rather than what is shown. The approval chain needs
              the database and is hidden.
            </>
          ) : (
            <>
              <strong>Rendered from the artefact.</strong> The database holds
              this plan&rsquo;s row for your post but not its render payload —
              a migration applied only halfway. The file below carries the same
              plan reference as that row, which is the only reason it is being
              shown; a file that did not match would show nothing at all.
            </>
          )}
        </p>
      )}
      {children(plan, { record, refresh })}
    </>
  );
}
