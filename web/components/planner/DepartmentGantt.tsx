"use client";

import { useMemo, useState } from "react";
import type { Department, PlanBlock, PlanPayload } from "@/lib/plan";
import { DAY_NAMES, DEPT_LABEL, blockColour } from "@/lib/plan";

const ROW_HEIGHT = 40;
const GUTTER = 104;
const DEPTS: Department[] = ["ENGG", "SNT", "TRD"];

/**
 * The same blocks, asked a different question.
 *
 * The time-distance charts above are organised by section and road, which is
 * the controller's question: what is occupied, and where. This is organised by
 * DEPARTMENT, which is the question the three Sr. officers actually argue
 * about in the block meeting: when is my gang on the line, and am I sharing
 * that possession with anyone.
 *
 * WHY THIS SHAPE. A clubbed block carries work for two or three departments,
 * so it is drawn once in each of their lanes and the lanes are TIED TOGETHER
 * with a vertical rule. One possession, several departments - which is the
 * entire thesis of the project, and it is invisible on a chart organised by
 * section because there the block is just one bar.
 *
 * Every rival Gantt found in the field is a list of tasks against time. This
 * is a list of DEPARTMENTS against time, and the crossings are the product.
 *
 * Nothing here is computed that the artefact does not already carry: the bars
 * are `plan.optimised.blocks`, and the summary counts them.
 */
export function DepartmentGantt({
  plan,
  blocks,
  onSelect,
  selectedId,
}: {
  plan: PlanPayload;
  blocks: PlanBlock[];
  onSelect?: (block: PlanBlock | null) => void;
  selectedId?: string | null;
}) {
  const [hover, setHover] = useState<string | null>(null);
  //  Roving tabindex, for the same reason as the chart above: one tab stop for
  //  the figure, arrow keys between bars. ~30 bars here, and making each its
  //  own tab stop would bury the next control behind all of them.
  const [focusIdx, setFocusIdx] = useState(0);

  const slots = plan.horizon.slots;
  const days = plan.horizon.days;
  const height = DEPTS.length * ROW_HEIGHT;
  const pct = (slot: number) => (slot / slots) * 100;

  //  One bar per (block, department it carries).
  const bars = useMemo(() => {
    const out: { block: PlanBlock; row: number }[] = [];
    for (const b of blocks) {
      for (const d of b.departments) {
        const row = DEPTS.indexOf(d);
        if (row >= 0) out.push({ block: b, row });
      }
    }
    return out;
  }, [blocks]);

  //  The ties: for a block spanning more than one lane, a vertical rule from
  //  its topmost department to its bottommost. Drawn from the rows the block
  //  actually occupies, not from `clubbed`, so a block whose departments do
  //  not resolve cannot silently gain a tie it has not earned.
  const ties = useMemo(() => {
    const out: { id: string; x: number; top: number; bottom: number }[] = [];
    for (const b of blocks) {
      const rows = b.departments
        .map((d) => DEPTS.indexOf(d))
        .filter((i) => i >= 0);
      if (rows.length < 2) continue;
      out.push({
        id: b.id,
        x: pct(b.startSlot),
        top: Math.min(...rows),
        bottom: Math.max(...rows),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, slots]);

  //  Per-department totals, counted off the same bars that are drawn.
  const summary = useMemo(
    () =>
      DEPTS.map((d) => {
        const mine = blocks.filter((b) => b.departments.includes(d));
        const shared = mine.filter((b) => b.departments.length > 1);
        const minutes = mine.reduce((s, b) => s + b.durationMin, 0);
        return { dept: d, blocks: mine.length, shared: shared.length, minutes };
      }),
    [blocks],
  );

  //  Department-visits per possession. 18 blocks serving 31 department-visits
  //  is the clubbing result in one number, and it is a count, not a model
  //  output - anyone can recount it off the bars.
  const visits = summary.reduce((s, r) => s + r.blocks, 0);

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-[17px] font-bold text-ink">
          Who is on the line, by department
        </h3>
        <span className="font-mono text-[11px] text-ink-mut">
          {blocks.length} possessions serving {visits} department-visits · a
          tied bar is one block carrying more than one department
        </span>
      </figcaption>

      <div className="overflow-hidden rounded-lg border border-rule bg-surface">
        {/* day ruler */}
        <div
          className="relative border-b border-rule bg-surface-sunk"
          style={{ height: 22 }}
        >
          <div className="absolute inset-y-0" style={{ left: GUTTER, right: 0 }}>
            {Array.from({ length: days }, (_, d) => (
              <span
                key={d}
                className="absolute top-0 flex h-full items-center border-l border-rule pl-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mut"
                style={{ left: `${(d / days) * 100}%`, width: `${100 / days}%` }}
              >
                {DAY_NAMES[d % 7]}
              </span>
            ))}
          </div>
        </div>

        <div className="relative" style={{ height }}>
          {/* row labels */}
          {summary.map((r, i) => (
            <div
              key={r.dept}
              className="absolute left-0 right-0 flex items-center border-b border-rule-soft last:border-0"
              style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <span
                className="flex h-full shrink-0 flex-col justify-center border-r border-rule bg-surface pl-3 pr-2"
                style={{ width: GUTTER }}
              >
                <span className="flex items-center gap-1.5 text-[12px] text-ink">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 shrink-0 rounded-[1px]"
                    style={{ background: `var(--${r.dept.toLowerCase()})` }}
                  />
                  {DEPT_LABEL[r.dept]}
                </span>
                <span className="font-mono text-[10px] text-ink-mut">
                  {r.blocks} blocks · {r.shared} shared
                </span>
              </span>
            </div>
          ))}

          {/* day gridlines */}
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{ left: GUTTER, right: 0 }}
          >
            {Array.from({ length: days }, (_, d) => (
              <span
                key={d}
                className="absolute inset-y-0 w-px bg-rule"
                style={{ left: `${(d / days) * 100}%` }}
              />
            ))}
          </div>

          <svg
            className="absolute inset-0 h-full w-full"
            style={{ paddingLeft: GUTTER }}
            role="group"
            aria-label={`Blocks by department: ${blocks.length} possessions over ${days} days. Use arrow keys to move between bars.`}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const next =
                e.key === "ArrowRight"
                  ? Math.min(focusIdx + 1, bars.length - 1)
                  : Math.max(focusIdx - 1, 0);
              setFocusIdx(next);
              const el = e.currentTarget.querySelectorAll("rect")[next];
              (el as SVGElement | undefined)?.focus();
            }}
          >
            <svg
              x={GUTTER}
              width={`calc(100% - ${GUTTER}px)`}
              height="100%"
              viewBox={`0 0 100 ${height}`}
              preserveAspectRatio="none"
              overflow="visible"
            >
              {/*  Ties first, so the bars sit on top of them.  */}
              {ties.map((t) => {
                const active = hover === t.id || selectedId === t.id;
                return (
                  <line
                    key={`tie-${t.id}`}
                    x1={t.x}
                    x2={t.x}
                    y1={t.top * ROW_HEIGHT + ROW_HEIGHT / 2}
                    y2={t.bottom * ROW_HEIGHT + ROW_HEIGHT / 2}
                    stroke="var(--clubbed)"
                    strokeWidth={active ? 2 : 1.25}
                    vectorEffect="non-scaling-stroke"
                    opacity={active ? 1 : 0.7}
                    pointerEvents="none"
                  />
                );
              })}

              {bars.map(({ block, row }, i) => {
                const x = pct(block.startSlot);
                const w = Math.max(pct(block.durSlots), 0.18);
                const active = hover === block.id || selectedId === block.id;
                const shared = block.departments.length > 1;
                return (
                  <rect
                    key={`${block.id}-${row}`}
                    x={x}
                    y={row * ROW_HEIGHT + 8}
                    width={w}
                    height={ROW_HEIGHT - 17}
                    rx={0.25}
                    fill={blockColour(block)}
                    opacity={active ? 1 : 0.88}
                    stroke={active ? "var(--ink)" : "none"}
                    strokeWidth={active ? 0.35 : 0}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer focus:outline-none focus-visible:stroke-[var(--ink)]"
                    tabIndex={i === focusIdx ? 0 : -1}
                    role="button"
                    aria-label={`${DEPT_LABEL[DEPTS[row]]}: ${block.section} ${block.scope} block, ${DAY_NAMES[block.day % 7]} ${block.startHHMM} to ${block.endHHMM}, ${shared ? `shared with ${block.departments.filter((d) => d !== DEPTS[row]).map((d) => DEPT_LABEL[d]).join(" and ")}` : "this department alone"}`}
                    onMouseEnter={() => setHover(block.id)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => {
                      setHover(block.id);
                      setFocusIdx(i);
                    }}
                    onBlur={() => setHover(null)}
                    onClick={() => onSelect?.(block)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect?.(block);
                      }
                    }}
                  >
                    <title>
                      {`${block.section} ${block.scope} · ${DAY_NAMES[block.day % 7]} ${block.startHHMM}–${block.endHHMM}\n` +
                        `${block.departments.map((d) => DEPT_LABEL[d]).join(" + ")}\n` +
                        (shared
                          ? "One possession, shared"
                          : "This department alone")}
                    </title>
                  </rect>
                );
              })}
            </svg>
          </svg>
        </div>
      </div>
    </figure>
  );
}
