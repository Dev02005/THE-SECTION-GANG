"use client";

import { Fragment, useState } from "react";
import { summarise, useActuals } from "@/lib/actuals";
import type { PlanPayload } from "@/lib/plan";
import { useSession } from "@/lib/session";
import type { PlanContext } from "@/components/ScopedPlan";
import { RecordRow } from "@/components/record/RecordRow";
import { RecordForm } from "@/components/record/RecordForm";

/**
 * The approved programme against what happened on the ground.
 *
 * The system used to stop at approval, so it could say whether a plan was
 * approved but never whether it was WORKABLE - whether blocks were given on
 * time, returned on time, availed at all. This is where that comes back.
 *
 * The operating branch records (the Sr.DOM, standing in for the Station
 * Masters and section controller the 425 posts do not include); everyone who
 * may see the plan may read it. Postgres enforces both, and refuses a record
 * on anything but an
 * approved plan. Every figure in the summary is computed from what was
 * recorded - a block with no record is "not recorded", never "on time".
 */
export function BlockRecord({ plan, ctx }: { plan: PlanPayload; ctx: PlanContext }) {
  const { session } = useSession();
  const record = ctx.record;
  const actuals = useActuals(record?.id ?? null);
  const [open, setOpen] = useState<string | null>(null);

  const blocks = [...plan.optimised.blocks].sort((a, b) => a.startSlot - b.startSlot);
  const rows = actuals.state === "ready" ? actuals.rows : [];
  const byId = new Map(rows.map((a) => [a.block_id, a]));
  const s = summarise(blocks, rows);

  const approved = record?.status === "approved";
  const officer = session?.officer ?? null;
  const canRecord =
    approved &&
    actuals.state === "ready" &&
    officer?.post === "SrDOM" &&
    officer.division_code === record?.division_code &&
    officer.zone_code === record?.zone_code;

  return (
    <section aria-label="Blocks as worked" className="flex flex-col gap-5">
      <header>
        <p className="eyebrow mb-1.5">Execution · {record?.reference ?? "no plan row"}</p>
        <h1 className="text-[26px] font-bold">Blocks as worked</h1>
        <p className="mt-2 max-w-[86ch] text-[14px] leading-relaxed text-ink-mid">
          The approved programme, block by block, against what happened on the
          ground: when each block was granted, when the line went back to
          traffic, and which were not availed. Recorded by the operating
          branch; every entry and every correction is kept in the audit log
          with the value it replaced.
        </p>
      </header>

      <Notice
        hasRow={record !== null}
        status={record?.status ?? null}
        unavailable={actuals.state === "unavailable"}
        canRecord={canRecord}
        post={officer?.designation ?? null}
      />

      {actuals.state === "ready" && (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Recorded" value={`${s.recorded} of ${s.total}`} note="blocks in the programme" />
          <Stat label="Granted late" value={String(s.grantedLate)}
                note={s.grantedLate ? `+${s.grantedLateMin} min in all` : "of those recorded"} />
          <Stat label="Returned late" value={String(s.returnedLate)}
                note={s.returnedLate ? `+${s.returnedLateMin} min of train paths` : "of those recorded"} />
          <Stat label="Not availed" value={String(s.notAvailed)}
                note={s.partial ? `and ${s.partial} partial` : "reason recorded for each"} />
          <Stat label="Block time used"
                value={s.plannedMinOfUsed ? `${(s.usedMin / 60).toFixed(1)} h` : "—"}
                note={s.plannedMinOfUsed ? `of ${(s.plannedMinOfUsed / 60).toFixed(1)} h planned for those blocks` : "none returned yet"} />
        </dl>
      )}

      <div className="relative overflow-x-auto rounded-lg border border-rule bg-surface">
        <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-rule bg-surface-sunk text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-mut">
              <th className="px-3 py-2 font-normal">Block</th>
              <th className="px-3 py-2 font-normal">Planned</th>
              <th className="px-3 py-2 font-normal">Granted</th>
              <th className="px-3 py-2 font-normal">Returned</th>
              <th className="px-3 py-2 font-normal">Planned · actual</th>
              <th className="px-3 py-2 font-normal">State</th>
              <th className="px-3 py-2 font-normal"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <Fragment key={b.id}>
                <RecordRow
                  block={b}
                  actual={byId.get(b.id) ?? null}
                  canRecord={canRecord}
                  onRecord={() => setOpen(open === b.id ? null : b.id)}
                />
                {canRecord && open === b.id && session !== null && record !== null && (
                  <tr className="border-b border-rule-soft">
                    <td colSpan={7} className="px-3 pb-3">
                      <RecordForm
                        block={b}
                        existing={byId.get(b.id) ?? null}
                        planId={record.id}
                        credential={session.credential}
                        onSaved={() => {
                          setOpen(null);
                          actuals.refresh();
                        }}
                        onCancel={() => setOpen(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="max-w-[86ch] text-[12.5px] leading-relaxed text-ink-mut">
        Times are the plan week&rsquo;s own: minutes from 00:00 on the Monday it
        begins, the origin every planned block uses. A correction replaces the
        row shown here and is logged with the value it replaced; a reset of the
        plan to draft clears the record and logs how much. The Sr.DOM records
        because the operating branch gives and takes back the line &mdash; on
        the ground, the Station Masters at each end of the section and the
        section controller, posts this demonstration does not model. Typed in
        here, not yet read from the Train Signal Register.
      </p>
    </section>
  );
}

function Notice({
  hasRow, status, unavailable, canRecord, post,
}: {
  hasRow: boolean;
  status: string | null;
  unavailable: boolean;
  canRecord: boolean;
  post: string | null;
}) {
  const cls = "rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed";
  if (!hasRow) {
    return (
      <p className={`${cls} border-rule text-ink-mid`}>
        The record of blocks as worked is kept in the database, against the
        plan&rsquo;s row, so there is nothing to show without one.
      </p>
    );
  }
  if (unavailable) {
    return (
      <p className={`${cls} border-caution bg-caution-soft text-ink`}>
        This database cannot keep a block record yet &mdash; migration{" "}
        <code className="font-mono">0013_block_record.sql</code> is not applied.
      </p>
    );
  }
  if (status !== "approved") {
    return (
      <p className={`${cls} border-rule text-ink-mid`}>
        This plan is <strong className="text-ink">{status}</strong>. A programme is
        worked once the DRM has approved it, so there is nothing to record until
        then &mdash; the database refuses a record against anything else.
      </p>
    );
  }
  return (
    <p className={`${cls} border-rule text-ink-mid`}>
      {canRecord
        ? "You record for this division. Each entry is checked by the database, which refuses times that contradict themselves."
        : `Recorded by this division's Sr.DOM. ${post ? `As ${post} you` : "You"} can read it but not change it.`}
    </p>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-rule bg-surface p-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mut">{label}</dt>
      <dd className="tnum mt-1 text-[20px] font-bold text-ink">{value}</dd>
      <dd className="mt-0.5 text-[11.5px] leading-snug text-ink-mut">{note}</dd>
    </div>
  );
}
