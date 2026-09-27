"use client";

import { useMemo, useState } from "react";
import type { PlanBlock, PlanPayload, Road } from "@/lib/plan";
import { DAY_NAMES, blockColour } from "@/lib/plan";
import { HeatCanvas } from "./HeatCanvas";

const ROW_HEIGHT = 26;
const GUTTER = 96;

export interface ChartRow {
  section: string;
  road: Road;
}

/**
 * One side of the comparison: a controller-style time-distance chart.
 *
 * Rows are (section, road), x is the full seven-day horizon. The detention
 * surface is painted behind on canvas; blocks sit above in SVG because they
 * are the only thing that needs hit-testing.
 *
 * A SECTION-scope block appears on BOTH roads of its section, which is the
 * power-block coupling made visible: OHE work takes the whole section down and
 * pays detention twice, which is precisely why it is worth filling with P.Way
 * and S&T work at the same location.
 */
export function TimeDistanceChart({
  plan,
  blocks,
  rows,
  title,
  subtitle,
  onSelect,
  selectedId,
}: {
  plan: PlanPayload;
  blocks: PlanBlock[];
  rows: ChartRow[];
  title: string;
  subtitle: string;
  onSelect?: (block: PlanBlock | null) => void;
  selectedId?: string | null;
}) {
  const [hover, setHover] = useState<string | null>(null);
  //  Roving tabindex: the chart is ONE tab stop and arrow keys move between
  //  blocks. Making every block its own tab stop would put ~120 of them
  //  between the chart and the next control, which is technically accessible
  //  and practically unusable.
  const [focusIdx, setFocusIdx] = useState(0);
  const slots = plan.horizon.slots;
  const slotsPerDay = plan.horizon.slotsPerDay;
  const days = plan.horizon.days;
  const height = rows.length * ROW_HEIGHT;

  const rowIndex = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(`${r.section}|${r.road}`, i));
    return m;
  }, [rows]);

  //  a block occupies one lane per road it takes
  const lanes = useMemo(() => {
    const out: { block: PlanBlock; row: number }[] = [];
    for (const b of blocks) {
      for (const road of b.roads) {
        const i = rowIndex.get(`${b.section}|${road}`);
        if (i !== undefined) out.push({ block: b, row: i });
      }
    }
    return out;
  }, [blocks, rowIndex]);

  const pct = (slot: number) => (slot / slots) * 100;
  //  Clamped for the same reason as the department chart: past the end of a
  //  shorter set of lanes, no block would be tabbable at all.
  const focus = Math.min(focusIdx, Math.max(0, lanes.length - 1));

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-[17px] font-bold text-ink">{title}</h3>
        <span className="font-mono text-[11px] text-ink-mut">{subtitle}</span>
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

        {/* plot */}
        <div className="relative" style={{ height }}>
          <HeatCanvas
            plan={plan}
            rows={rows}
            rowHeight={ROW_HEIGHT}
            gutter={GUTTER}
          />

          {/* row labels + separators */}
          {rows.map((r, i) => (
            <div
              key={`${r.section}|${r.road}`}
              className="absolute left-0 right-0 flex items-center border-b border-rule-soft last:border-0"
              style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <span
                className="flex h-full shrink-0 items-center border-r border-rule bg-surface pl-3 pr-2 font-mono text-[10.5px] text-ink-mid"
                style={{ width: GUTTER }}
              >
                {r.section}
                <span className="ml-1 text-ink-faint">{r.road}</span>
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

          {/* blocks */}
          <svg
            className="absolute inset-0 h-full w-full"
            style={{ paddingLeft: GUTTER }}
            role="group"
            aria-label={`${title}: ${blocks.length} blocks over ${days} days. Use arrow keys to move between blocks.`}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const next =
                e.key === "ArrowRight"
                  ? Math.min(focus + 1, lanes.length - 1)
                  : Math.max(focus - 1, 0);
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
              {lanes.map(({ block, row }, i) => {
                const x = pct(block.startSlot);
                const w = Math.max(pct(block.durSlots), 0.18);
                const active = hover === block.id || selectedId === block.id;
                return (
                  <rect
                    key={`${block.id}-${row}`}
                    x={x}
                    y={row * ROW_HEIGHT + 3}
                    width={w}
                    height={ROW_HEIGHT - 7}
                    rx={0.25}
                    fill={blockColour(block)}
                    opacity={active ? 1 : 0.88}
                    stroke={active ? "var(--ink)" : "none"}
                    strokeWidth={active ? 0.35 : 0}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer focus:outline-none focus-visible:stroke-[var(--ink)]"
                    tabIndex={i === focus ? 0 : -1}
                    role="button"
                    aria-label={`${block.section} ${block.scope} block, ${DAY_NAMES[block.day % 7]} ${block.startHHMM} to ${block.endHHMM}, ${block.departments.join(" and ")}, ${block.detentionMinutes} detention minutes`}
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
                        `${block.departments.join(" + ")} · ${block.detentionMinutes} detention-min\n` +
                        block.tasks
                          .map((t) => `${t.id} ${t.activity}`)
                          .join("\n")}
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
