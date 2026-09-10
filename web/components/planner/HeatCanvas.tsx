"use client";

import { useEffect, useRef } from "react";
import type { PlanPayload, Road } from "@/lib/plan";
import { rowKey } from "@/lib/plan";

/**
 * The detention cost surface, drawn behind the plan.
 *
 * 672 slots x 8 rows = 5,376 cells. SVG stutters at that count and gains
 * nothing - these cells are never hit-tested, only looked at - so this is
 * Canvas, and the interactive blocks sit in an SVG layer above it.
 *
 * This strip is the thing no rival can copy. Drawing it requires a cost
 * surface, and not one of the seven competing submissions computes one at all.
 * It is what makes "this block sits in expensive capacity" visible in a glance
 * rather than a paragraph.
 */
export function HeatCanvas({
  plan,
  rows,
  rowHeight,
  gutter,
}: {
  plan: PlanPayload;
  rows: { section: string; road: Road }[];
  rowHeight: number;
  gutter: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    // the surface's own maximum sets the ramp, so the scale is honest rather
    // than clipped to a round number
    let peak = 1;
    for (const r of rows) {
      for (const v of plan.detentionSurface[rowKey(r.section, r.road)] ?? []) {
        if (v > peak) peak = v;
      }
    }

    const draw = () => {
      const width = parent.clientWidth;
      const height = rows.length * rowHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const plotWidth = width - gutter;
      const slots = plan.horizon.slots;
      const slotWidth = plotWidth / slots;

      //  Gamma, not a linear ramp. Linear alpha saturated almost the whole week
      //  in red, which destroyed the one thing this strip exists to show: WHERE
      //  the corridor is genuinely cheap. Raising t to a power makes the
      //  mid-range fade fast so the night and mid-day corridors read as clearly
      //  cheap rather than as merely less red.
      const alphaFor = (v: number) =>
        Math.pow(Math.min(1, v / peak), 1.9) * 0.5;

      rows.forEach((r, i) => {
        const series = plan.detentionSurface[rowKey(r.section, r.road)];
        if (!series) return;
        const y = i * rowHeight;

        //  Draw contiguous runs of equal value as ONE rect.
        //
        //  Drawing per-slot meant each cell was painted wider than its own
        //  advance to avoid sub-pixel seams - so every cell overlapped its
        //  neighbour and the alpha COMPOUNDED, turning a 5x cost ratio into a
        //  uniform wash of red. Runs remove the overlap entirely, and are
        //  fewer draw calls besides.
        let start = 0;
        for (let s = 1; s <= slots; s++) {
          if (s < slots && series[s] === series[start]) continue;
          const alpha = alphaFor(series[start]);
          if (alpha > 0.015) {
            ctx.fillStyle = `rgba(220, 38, 38, ${alpha.toFixed(3)})`;
            ctx.fillRect(
              gutter + start * slotWidth,
              y + 1,
              (s - start) * slotWidth,
              rowHeight - 2,
            );
          }
          start = s;
        }
      });
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [plan, rows, rowHeight, gutter]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    />
  );
}
