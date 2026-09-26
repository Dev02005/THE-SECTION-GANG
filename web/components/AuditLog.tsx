"use client";

import type { DbAuditRow } from "@/lib/db";
import { roleById } from "@/lib/roles";
import { useAudit } from "@/lib/useAudit";
import { asRole, useSession } from "@/lib/session";

/**
 * The append-only record of every state change, attributed to a post.
 *
 * The table existed from the first migration and four routines have been
 * writing to it since - nothing read it. A log nobody can see is a log nobody
 * can rely on, and "who approved this, and when" is the first question asked
 * of any planning document a division issues.
 *
 * WHAT MAKES IT AN AUDIT LOG rather than a list of events: `audit_log` has a
 * select policy and an insert policy and NO update or delete policy, and no
 * routine in the schema edits or removes a row. A client holding the
 * publishable key cannot revise history; it can only add to it. That is stated
 * on the page because it is the property that makes the page worth having.
 */
export function AuditLog() {
  const { rows, loading, live, error, unreachable, refresh } = useAudit(100);
  const { session } = useSession();
  const me = asRole(session);

  return (
    <section aria-label="Audit log">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1.5">Append-only · attributed</p>
          <h1 className="text-[26px] font-bold">Audit log</h1>
        </div>
        <button
          type="button"
          onClick={refresh}
          //  Disabled only while a read is in flight, NOT when the last one
          //  failed - a failed read is exactly when someone wants to try
          //  again, and gating it on `live` meant the only way back was to
          //  reload the page.
          disabled={loading}
          className="rounded border border-rule px-3 py-1.5 font-mono text-[11px] text-ink-mid transition-colors hover:border-ink-mut hover:text-ink disabled:opacity-40"
        >
          {loading ? "Reading…" : "Refresh"}
        </button>
      </header>

      {/*  The scope is stated before the rows, not after. "My audit log" would
           read as this division's, and it is not - it is the zone's.  */}
      <p className="justified mb-5 max-w-[70ch] text-[14px] leading-relaxed text-ink-mid">
        Every change of state written by an officer of{" "}
        <strong className="font-semibold text-ink">
          {me ? `${me.zone.name} (${me.zone.code})` : "this zone"}
        </strong>
        , newest first — not this division alone, because a zone&rsquo;s
        officers answer to the same General Manager. The table has no update
        policy and no delete policy, and no routine in the schema edits a row,
        so this can be added to and not revised.
      </p>

      {error !== null && (
        <Note tone="bad">
          The log could not be read: {error}. That is a failure to query, not an
          empty history — the two are deliberately not shown the same way.
        </Note>
      )}

      {unreachable && !loading && (
        <Note tone="bad">
          The database is configured but could not be reached, so the history
          is unknown from here. That is not the same as an empty log, and this
          page will not show one in its place — the rest of the application is
          running on the engine&rsquo;s static file, which has no history to
          have.
        </Note>
      )}

      {!live && !unreachable && error === null && !loading && (
        <Note>
          This build has no database configured, so there is no history to read.
          The page shows nothing rather than a plausible sequence of approvals,
          which is the one thing an audit log must never invent.
        </Note>
      )}

      {live && !loading && rows.length === 0 && (
        <Note>
          Nothing has been recorded yet. Submit a plan as Sr.DEN, Sr.DSTE or
          Sr.DEE, or decide one as DRM, and the entry appears here attributed to
          that post.
        </Note>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-rule">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <caption className="sr-only">Audit log entries, newest first</caption>
            <thead>
              <tr className="border-b border-rule bg-surface-sunk text-left">
                <Th>When</Th>
                <Th>Post</Th>
                <Th>Action</Th>
                <Th>Subject</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Entry key={`${r.log_at}-${r.log_actor}-${i}`} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="mt-3 font-mono text-[11px] text-ink-mut">
          {rows.length} {rows.length === 1 ? "entry" : "entries"} · Postgres caps
          this at 200
        </p>
      )}
    </section>
  );
}

function Entry({ row }: { row: DbAuditRow }) {
  const who = roleById(row.log_actor);
  const act = describe(row.log_action);

  return (
    <tr className="border-b border-rule-soft last:border-b-0">
      <td className="px-3 py-2 align-top">
        <time
          dateTime={row.log_at}
          title={row.log_at}
          className="tnum font-mono text-[11.5px] text-ink-mid"
        >
          {when(row.log_at)}
        </time>
      </td>

      <td className="px-3 py-2 align-top">
        {/*  Resolved to a designation where the id is one this build knows, and
             shown raw where it is not. A post the generated list has never
             heard of is a fact about the database, not a row to prettify.  */}
        <span className="block text-ink">{who?.designation ?? "Unknown post"}</span>
        <span className="block font-mono text-[10.5px] text-ink-mut">
          {row.log_actor}
        </span>
        {who?.division != null && (
          <span className="block text-[11.5px] text-ink-mut">
            {who.division.name}
          </span>
        )}
      </td>

      <td className="px-3 py-2 align-top">
        <span
          className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10.5px] ${act.tone}`}
        >
          {act.label}
        </span>
        {!act.known && (
          <span className="mt-0.5 block text-[11px] text-ink-mut">
            unrecognised action, shown as stored
          </span>
        )}
      </td>

      <td className="px-3 py-2 align-top">
        <span className="block text-[12.5px] text-ink-mid">{row.log_entity}</span>
        {row.log_entity_id !== null && (
          <span className="block max-w-[26ch] truncate font-mono text-[10.5px] text-ink-mut">
            {row.log_entity_id}
          </span>
        )}
        <Detail detail={row.log_detail} />
      </td>
    </tr>
  );
}

/**
 * The `detail` column, rendered as what it is.
 *
 * Only two shapes are ever written - a rejection's `reason` and the reset's
 * `note` - but the column is free jsonb, so anything else is printed as
 * key/value rather than dropped. Dropping it would hide the one field a
 * rejection carries its meaning in.
 */
function Detail({ detail }: { detail: Record<string, unknown> | null }) {
  if (detail === null) return null;
  const pairs = Object.entries(detail).filter(([, v]) => v !== null && v !== "");
  if (pairs.length === 0) return null;

  return (
    <dl className="mt-1 flex flex-col gap-0.5">
      {pairs.map(([k, v]) => (
        <div key={k} className="flex gap-1.5 text-[11.5px]">
          <dt className="shrink-0 font-mono text-ink-mut">{k}</dt>
          <dd className="text-ink-mid">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

interface Described {
  label: string;
  tone: string;
  /** False for an action this build has never heard of, which is shown raw. */
  known: boolean;
}

/** Machine action to something a DRM would read, without losing the original. */
function describe(action: string): Described {
  const plain = "bg-surface-sunk text-ink-mid";
  switch (action) {
    case "plan.submitted":
      return { label: "Submitted", tone: "bg-surface-sunk text-ink", known: true };
    case "plan.approved":
      return { label: "Approved", tone: "bg-accent-soft text-accent", known: true };
    case "plan.rejected":
      return { label: "Rejected", tone: "bg-surface-sunk text-caution", known: true };
    case "plan.reset":
      return { label: "Reset to draft", tone: plain, known: true };
    case "officer.password_changed":
      return { label: "Password changed", tone: plain, known: true };
    case "officer.password_restored":
      return { label: "Password restored", tone: plain, known: true };
    default:
      return { label: action, tone: plain, known: false };
  }
}

/**
 * `06 Sep 23:40`, in the reader's own timezone, with the full timestamp on
 * hover. Formatted here rather than in Postgres because the entry is written
 * in UTC and read by someone sitting in a division.
 */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-[0.1em] text-ink-mut"
    >
      {children}
    </th>
  );
}

function Note({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "bad";
}) {
  return (
    <p
      className={`justified max-w-[70ch] rounded-lg border px-4 py-3 text-[13.5px] leading-relaxed text-ink-mid ${
        tone === "bad" ? "border-caution" : "border-rule"
      }`}
    >
      {children}
    </p>
  );
}
