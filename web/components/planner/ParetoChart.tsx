"use client";

import { useState } from "react";
import type { PlanPayload } from "@/lib/plan";

/**
 * The trade-off, measured.
 *
 * x  train detention caused
 * y  residual asset risk carried
 *
 * Each dot is a real re-solve at a different risk weight. Raising that weight
 * buys risk down by spending line capacity, and the curve is the price list for
 * that exchange - a Sr.DEN can read their own policy off it.
 *
 * Dominated points are drawn hollow rather than dropped. A point can be worse
 * on both axes simply because that solve got a worse incumbent under its
 * budget, and a curve drawn only through the convenient results would be a
 * drawing rather than a measurement.
 */
export function ParetoChart({ pareto }: { pareto: PlanPayload["pareto"] }) {
  const [active, setActive] = useState<number | null>(null);
  if (!pareto || pareto.points.length < 2) return null;

  const pts = pareto.points;
  const W = 460;
  const H = 300;
  const PAD = { t: 14, r: 16, b: 42, l: 60 };

  const xs = pts.map((p) => p.detention_minutes);
  const ys = pts.map((p) => p.risk_carried);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const padX = (xMax - xMin) * 0.12 || 1;
  const padY = (yMax - yMin) * 0.12 || 1;

  const sx = (v: number) =>
    PAD.l +
    ((v - (xMin - padX)) / (xMax + padX - (xMin - padX))) * (W - PAD.l - PAD.r);
  const sy = (v: number) =>
    H -
    PAD.b -
    ((v - (yMin - padY)) / (yMax + padY - (yMin - padY))) * (H - PAD.t - PAD.b);

  //  the frontier line joins only non-dominated points, left to right
  const frontier = pts
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.dominated_by === null)
    .sort((a, b) => a.p.detention_minutes - b.p.detention_minutes);

  const xTicks = [xMin, Math.round((xMin + xMax) / 2), xMax];
  const yTicks = [yMin, Math.round((yMin + yMax) / 2), yMax];
  const shown = active !== null ? pts[active] : null;

  return (
    <section className="rounded-lg border border-rule bg-surface p-4">
      <h3 className="signal-rule eyebrow mb-1">The trade-off, measured</h3>
      <p className="mb-3 text-[11.5px] leading-relaxed text-ink-mut">
        {pts.length} re-solves across the risk weight. Buying risk down costs
        line capacity; this is the price list.
      </p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Risk carried against train detention across ${pts.length} policy settings`}
      >
        {/* axes */}
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--rule)" />
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--rule)" />

        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line
              x1={sx(t)}
              y1={H - PAD.b}
              x2={sx(t)}
              y2={H - PAD.b + 4}
              stroke="var(--rule)"
            />
            <text
              x={sx(t)}
              y={H - PAD.b + 16}
              textAnchor="middle"
              fill="var(--ink-mut)"
              fontSize="9"
              fontFamily="var(--font-mono)"
            >
              {t.toLocaleString()}
            </text>
          </g>
        ))}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.l - 4} y1={sy(t)} x2={PAD.l} y2={sy(t)} stroke="var(--rule)" />
            <text
              x={PAD.l - 7}
              y={sy(t) + 3}
              textAnchor="end"
              fill="var(--ink-mut)"
              fontSize="9"
              fontFamily="var(--font-mono)"
            >
              {t.toLocaleString()}
            </text>
          </g>
        ))}

        <text
          x={(PAD.l + W - PAD.r) / 2}
          y={H - 6}
          textAnchor="middle"
          fill="var(--ink-mut)"
          fontSize="9.5"
        >
          Train detention (min) →
        </text>
        <text
          x={12}
          y={(PAD.t + H - PAD.b) / 2}
          textAnchor="middle"
          fill="var(--ink-mut)"
          fontSize="9.5"
          transform={`rotate(-90 12 ${(PAD.t + H - PAD.b) / 2})`}
        >
          ← Risk carried
        </text>

        {/* frontier through the non-dominated points only */}
        {frontier.length > 1 && (
          <polyline
            points={frontier
              .map(({ p }) => `${sx(p.detention_minutes)},${sy(p.risk_carried)}`)
              .join(" ")}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            opacity={0.55}
          />
        )}

        {pts.map((p, i) => {
          const dominated = p.dominated_by !== null;
          const here = p.is_current_policy;
          return (
            <g
              key={i}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              className="cursor-pointer"
            >
              <circle
                cx={sx(p.detention_minutes)}
                cy={sy(p.risk_carried)}
                r={here ? 6 : 4.5}
                fill={dominated ? "var(--surface)" : "var(--accent)"}
                stroke={here ? "var(--ink)" : "var(--accent)"}
                strokeWidth={here ? 2 : 1.2}
              />
              <title>
                {`risk weight ${p.alpha_risk} — ${p.detention_minutes.toLocaleString()} detention-min, ` +
                  `${p.risk_carried.toLocaleString()} risk carried, ${p.blocks} blocks` +
                  (dominated ? " (dominated)" : "") +
                  (here ? " (current policy)" : "")}
              </title>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 min-h-[52px] rounded border border-rule-soft px-3 py-2 text-[11.5px] leading-relaxed text-ink-mid">
        {shown ? (
          <>
            <span className="font-mono text-ink">α_risk {shown.alpha_risk}</span>
            {shown.is_current_policy && (
              <span className="text-accent"> · current policy</span>
            )}
            {shown.dominated_by !== null && (
              <span className="text-caution"> · dominated</span>
            )}
            <br />
            {shown.detention_minutes.toLocaleString()} detention-min ·{" "}
            {shown.risk_carried.toLocaleString()} risk · {shown.blocks} blocks ·{" "}
            {shown.scheduled} tasks · statutory {shown.statutory_done}/
            {shown.statutory_total}
          </>
        ) : (
          <span className="text-ink-mut">
            Hover a point. Hollow points are dominated — worse on both axes than
            another solve, shown rather than hidden.
          </span>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-mut">
        {pareto.note}
      </p>
    </section>
  );
}
