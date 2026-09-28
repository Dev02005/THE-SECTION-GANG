"use client";

import { useState } from "react";
import { decidePlan, resetPlan, submitPlan } from "@/lib/db";
import type { PlanState } from "@/lib/usePlan";
import { useSession } from "@/lib/session";

/**
 * Where a plan is in the approval chain, and what this post can do about it.
 *
 * The chain was enforced in Postgres for a fortnight before it had a screen,
 * which meant every post saw the same page and the strongest thing in the
 * system was invisible. This is that screen.
 *
 * IT DOES NOT DECIDE ANYTHING. `submit_plan` accepts only Sr.DEN, Sr.DSTE or
 * Sr.DEE of that plan's own division, and only while it is a draft or has been
 * sent back; `decide_plan` accepts only that division's DRM, only once it has
 * been submitted, and refuses a rejection with no reason. Those rules live in
 * the database. What this component does is show the right button to the right
 * post - a courtesy, not a control. Anyone who edits it out of the page still
 * gets refused, and the test suite proves that by trying.
 *
 * The separation is the point of the whole panel: the three engineers who
 * submit cannot approve, and the DRM who approves cannot submit. One officer
 * cannot push a plan through alone.
 */

const SUBMITTERS = ["SrDEN", "SrDSTE", "SrDEE"];

const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-rule text-ink-mid" },
  submitted: { label: "Submitted", className: "border-caution text-caution" },
  approved: { label: "Approved", className: "border-go text-go" },
  rejected: { label: "Rejected", className: "border-danger text-danger" },
  superseded: { label: "Superseded", className: "border-rule text-ink-mut" },
};

export function ApprovalPanel({
  record,
  refresh,
  checksOk,
}: {
  record: PlanState["record"];
  refresh: () => void;
  /** A passing set of pre-approval checks that belongs to this plan. */
  checksOk: boolean;
}) {
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  //  No row means the static artefact, which belongs to no division and has no
  //  chain to be in. Saying "draft" over it would invent a state.
  if (record === null || session === null) return null;

  const post = session.officer.post;
  const status = record.status;
  //  A rejected plan is revised and brought again, which is why this is not
  //  just `status === "draft"`.
  const canSubmit =
    SUBMITTERS.includes(post) && (status === "draft" || status === "rejected");
  const canDecide = post === "DRM" && status === "submitted";
  //  The DRM can put a decided plan back. Demonstration only, and the button
  //  says so - see reset_plan's comment in 0010.
  const canReset = post === "DRM" && status !== "draft";
  const chip = STATUS[status] ?? STATUS.draft;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setRejecting(false);
      setReason("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The database refused that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Approval"
      className="mb-5 rounded-lg border border-rule bg-surface p-3 print:hidden"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-mut">
          Approval
        </span>
        <span
          className={`rounded border px-2 py-0.5 font-mono text-[11px] ${chip.className}`}
        >
          {chip.label}
        </span>
        <span className="font-mono text-[11px] text-ink-mut">
          {record.reference}
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-2">
          {canSubmit && (
            <button
              type="button"
              disabled={busy || !checksOk}
              title={checksOk ? undefined : "Needs a passing set of pre-approval checks"}
              onClick={() =>
                act(() => submitPlan(session.credential, record.id))
              }
              className="rounded bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Sending…" : "Submit to the DRM"}
            </button>
          )}
          {canReset && !rejecting && (
            <button
              type="button"
              disabled={busy}
              title="Demonstration only: a real programme is superseded, not un-approved"
              onClick={() => act(() => resetPlan(session.credential, record.id))}
              className="rounded border border-rule px-3 py-1.5 text-[12.5px] text-ink-mut transition-colors hover:border-ink-mut hover:text-ink"
            >
              Reset to draft
            </button>
          )}
          {canDecide && !rejecting && (
            <>
              <button
                type="button"
                disabled={busy || !checksOk}
                title={checksOk ? undefined : "Needs a passing set of pre-approval checks"}
                onClick={() =>
                  act(() => decidePlan(session.credential, record.id, true))
                }
                className="rounded bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? "Working…" : "Approve"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRejecting(true)}
                className="rounded border border-rule px-3 py-1.5 text-[12.5px] text-ink-mid transition-colors hover:border-danger hover:text-danger"
              >
                Reject
              </button>
            </>
          )}
        </span>
      </div>

      {/*  Reject and reset stay open: a DRM must always be able to send back a
           plan that fails. Only moving it FORWARD needs the checks.  */}
      {(canSubmit || canDecide) && !checksOk && (
        <p className="mt-2 text-[12px] leading-relaxed text-ink">
          Submission and approval are held until this plan has a passing set of
          pre-approval checks.
        </p>
      )}

      {/*  A rejection needs a reason. The database refuses one without it, so
           the field is not a formality - it is the same rule, shown early.  */}
      {canDecide && rejecting && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is it going back? The DRM's reason is recorded."
            aria-label="Reason for rejection"
            className="min-w-[240px] flex-1 rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus-visible:border-accent"
          />
          <button
            type="button"
            disabled={busy || reason.trim() === ""}
            onClick={() =>
              act(() =>
                decidePlan(session.credential, record.id, false, reason.trim()),
              )
            }
            className="rounded bg-danger px-3 py-1.5 text-[12.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            Send it back
          </button>
          <button
            type="button"
            onClick={() => setRejecting(false)}
            className="rounded px-2 py-1.5 text-[12.5px] text-ink-mut hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}

      <p className="mt-2 text-[12px] leading-relaxed text-ink-mut">
        <Trail record={record} />{" "}
        {canSubmit
          ? "You may submit this plan; only the DRM can approve it."
          : canDecide
            ? "You may approve or reject it. A rejection needs a reason."
            : status === "draft"
              ? "Sr.DEN, Sr.DSTE or Sr.DEE submit; the DRM decides."
              : "Only this division's DRM can decide it."}
      </p>

      {error !== null && (
        <p role="status" className="mt-1.5 text-[12px] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/** Who did what, from the row itself rather than from an assumption. */
function Trail({ record }: { record: NonNullable<PlanState["record"]> }) {
  if (record.decided_by !== null) {
    return (
      <>
        {record.status === "approved" ? "Approved" : "Rejected"} by{" "}
        <strong className="text-ink-mid">{record.decided_by}</strong>
        {record.decision_reason !== null && <> — “{record.decision_reason}”</>}.
      </>
    );
  }
  if (record.submitted_by !== null) {
    return (
      <>
        Submitted by{" "}
        <strong className="text-ink-mid">{record.submitted_by}</strong>, waiting
        on the DRM.
      </>
    );
  }
  return <>Not yet submitted.</>;
}
