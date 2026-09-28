"use client";

import type { DbActual } from "@/lib/db";
import { DAYS, dayOf, delta, hhmm, plannedEnd, plannedStart } from "@/lib/actuals";
import type { PlanBlock } from "@/lib/plan";

const STATE: Record<DbActual["state"], { label: string; cls: string }> = {
  granted: { label: "Block on", cls: "border-caution text-caution" },
  completed: { label: "Completed", cls: "border-go text-go" },
  partial: { label: "Partial", cls: "border-caution text-caution" },
  not_availed: { label: "Not availed", cls: "border-danger text-danger" },
};

/**
 * One block: what was planned, what happened, and by how much they differ.
 *
 * Late is shown as late and early as early - a block returned twenty minutes
 * late is twenty minutes of a train path the timetable counted on, and that is
 * the number an operating officer is asked about.
 */
export function RecordRow({
  block,
  actual,
  canRecord,
  onRecord,
}: {
  block: PlanBlock;
  actual: DbActual | null;
  canRecord: boolean;
  onRecord: () => void;
}) {
  const p0 = plannedStart(block);
  const p1 = plannedEnd(block);
  const scope = block.scope === "SECTION" ? "both roads" : `${block.scope} road`;
  const chip = actual ? STATE[actual.state] : null;

  return (
    <tr className="border-b border-rule-soft align-top last:border-b-0">
      <td className="px-3 py-2">
        <span className="block font-medium text-ink">
          {DAYS[block.day % 7]} · {block.section} · {scope}
        </span>
        <span className="block font-mono text-[10.5px] text-ink-mut">
          {block.departments.join(" + ")} · {block.tasks.length}{" "}
          {block.tasks.length === 1 ? "job" : "jobs"}
        </span>
      </td>
      <td className="tnum px-3 py-2 font-mono text-[12px] text-ink-mid">
        {hhmm(p0)}–{hhmm(p1)}
      </td>
      <td className="tnum px-3 py-2 font-mono text-[12px]">
        <Actual at={actual?.granted_min ?? null} planned={p0} />
      </td>
      <td className="tnum px-3 py-2 font-mono text-[12px]">
        <Actual at={actual?.returned_min ?? null} planned={p1} />
      </td>
      <td className="px-3 py-2">
        <Timeline p0={p0} p1={p1} a={actual} />
      </td>
      <td className="px-3 py-2">
        {chip ? (
          <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10.5px] ${chip.cls}`}>
            {chip.label}
          </span>
        ) : (
          <span className="font-mono text-[10.5px] text-ink-mut">not recorded</span>
        )}
        {actual?.note && (
          <span className="mt-1 block max-w-[28ch] text-[11.5px] leading-snug text-ink-mid">
            {actual.note}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {canRecord && (
          <button
            type="button"
            onClick={onRecord}
            className="rounded border border-rule px-2.5 py-1 text-[12px] text-ink-mid transition-colors hover:border-accent hover:text-accent"
          >
            {actual ? "Correct" : "Record"}
          </button>
        )}
      </td>
    </tr>
  );
}

/** "01:12" and "+12 min", with the day named when it is not the planned one. */
function Actual({ at, planned }: { at: number | null; planned: number }) {
  if (at === null) return <span className="text-ink-mut">—</span>;
  const d = at - planned;
  const tone = d > 0 ? "text-caution" : "text-go";
  return (
    <>
      <span className="block text-ink">
        {dayOf(at) !== dayOf(planned) && `${DAYS[dayOf(at) % 7]} `}
        {hhmm(at)}
      </span>
      <span className={`block text-[10.5px] ${tone}`}>{delta(d)}</span>
    </>
  );
}

/**
 * Planned span outlined, actual span filled, on the block's own window with an
 * hour either side. The same facts as the columns beside it, so it is hidden
 * from assistive technology rather than described twice.
 */
function Timeline({ p0, p1, a }: { p0: number; p1: number; a: DbActual | null }) {
  const W = 132;
  const lo = p0 - 60;
  const hi = p1 + 60;
  const x = (m: number) => Math.max(0, Math.min(W, ((m - lo) / (hi - lo)) * W));
  const g = a?.granted_min ?? null;
  const r = a?.returned_min ?? null;
  return (
    <svg width={W} height={18} viewBox={`0 0 ${W} 18`} aria-hidden="true" className="block">
      <rect x={x(p0)} y={3} width={x(p1) - x(p0)} height={12} rx={2}
            fill="none" stroke="var(--ink-mut)" strokeDasharray="3 2" />
      {g !== null && (
        <rect x={x(g)} y={6} width={Math.max(2, x(r ?? g + 10) - x(g))} height={6} rx={1.5}
              fill={r === null ? "var(--caution)" : r > p1 ? "var(--caution)" : "var(--go)"} />
      )}
      {a?.state === "not_availed" && (
        <line x1={x(p0)} y1={15} x2={x(p1)} y2={3} stroke="var(--danger)" strokeWidth={1.5} />
      )}
    </svg>
  );
}
