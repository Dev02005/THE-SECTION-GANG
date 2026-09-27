"use client";

import { useMemo, useState } from "react";
import type { PlanPayload } from "@/lib/plan";
import type { CorridorStop } from "@/lib/stations";

/**
 * The corridor, drawn from the coordinates the chainages were computed from.
 *
 * NOT a schematic. The five stops are placed by their published latitude and
 * longitude (DataMeet `railways`, CC0), so the bend at Kottavalasa where the
 * line turns north-east is the real bend, and the spacing is the real
 * spacing. The same coordinates produce `engine/core/stations.py`'s haversine
 * chainages - 0, 21.3, 28.6, 37.9, 55.0 km - so the picture and the model's
 * geometry cannot disagree; they are the same six numbers.
 *
 * WHAT THE COLOUR MEANS, and what it deliberately does NOT.
 *
 * The first version shaded each section by its mean detention cost, which
 * sounded right and showed nothing: the four means are 44, 45, 43 and 44
 * minutes per slot - a spread of TWO - so all four segments rendered the same
 * shade. Normalising that spread to fill the colour range would have turned a
 * two-minute difference into a dramatic picture, which is the kind of chart
 * this project exists not to draw.
 *
 * The measurement is the point: on this corridor detention varies about 35x
 * more by HOUR than by SECTION (a 69-minute spread across the day against 2
 * across the line). Cost here is a time phenomenon, not a geography one, and
 * the page says so - the heat strip on the planner is where that variation
 * belongs, and it already shows it.
 *
 * So the colour carries what genuinely differs between sections: how many
 * blocks the plan places on each. Both spreads are computed here from the
 * artefact rather than typed in, so the sentence cannot drift from the data.
 *
 * The line is a straight run between consecutive stops rather than the track's
 * true curvature, which we do not hold. That is stated on the page rather than
 * smoothed over - the same reason the chainages are reported as great-circle
 * distances and not multiplied by an invented route factor.
 */
export function CorridorMap({
  plan,
  chain,
}: {
  plan: PlanPayload;
  /** The five stops with their coordinates, resolved on the server. */
  chain: CorridorStop[];
}) {
  const [hover, setHover] = useState<string | null>(null);

  //  Mean detention cost per section, across both roads and the whole
  //  horizon. Read from the artefact; nothing is recomputed here.
  const pressure = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of plan.sections) {
      const vals: number[] = [];
      for (const road of plan.roads) {
        const series = plan.detentionSurface[`${s.id}|${road}`];
        if (Array.isArray(series)) vals.push(...series);
      }
      out.set(s.id, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
    }
    return out;
  }, [plan]);

  const blocksBySection = useMemo(() => {
    const out = new Map<string, number>();
    for (const b of plan.optimised.blocks) {
      out.set(b.section, (out.get(b.section) ?? 0) + 1);
    }
    return out;
  }, [plan]);

  const maxBlocks = Math.max(...blocksBySection.values(), 1);

  //  The two spreads the note quotes, measured rather than asserted.
  const spread = useMemo(() => {
    const perSection = [...pressure.values()];
    const bySection = Math.max(...perSection) - Math.min(...perSection);

    const spd = plan.horizon.slotsPerDay;
    const series = Object.values(plan.detentionSurface);
    const n = series[0]?.length ?? 0;
    const perSlot: number[] = [];
    for (let i = 0; i < spd; i++) {
      let sum = 0, count = 0;
      for (const s of series) {
        for (let j = i; j < n; j += spd) { sum += s[j]; count++; }
      }
      perSlot.push(count ? sum / count : 0);
    }
    return {
      bySection: Math.round(bySection),
      byHour: Math.round(Math.max(...perSlot) - Math.min(...perSlot)),
    };
  }, [pressure, plan]);

  //  Project lon/lat, then ROTATE so the corridor runs left to right.
  //
  //  Longitude is scaled by cos(lat) first, so the shape is not stretched
  //  east-west at 18 degrees north. But this line runs almost due north -
  //  0.41 degrees of latitude against 0.23 of longitude, an aspect of 1.76 -
  //  and drawn north-up in a panel it collapses into a vertical sliver with
  //  every station label on top of the next. That is what the first version
  //  did.
  //
  //  So the whole corridor is rotated onto its own axis, which is what a
  //  railway strip map does and what a section diagram in a block plan looks
  //  like. The rotation preserves every distance and every angle BETWEEN
  //  stops, so the bend at Kottavalasa stays the real bend; only the
  //  orientation on the page changes. A north arrow carries the true bearing
  //  so nothing about direction is hidden.
  const geom = useMemo(() => {
    if (chain.length < 2) return null;
    const latMid = chain.reduce((a, c) => a + c.station.lat, 0) / chain.length;
    const k = Math.cos((latMid * Math.PI) / 180);
    const raw = chain.map((c) => ({ stop: c, x: c.station.lon * k, y: c.station.lat }));

    //  Angle of the whole run, first stop to last.
    const dx = raw[raw.length - 1].x - raw[0].x;
    const dy = raw[raw.length - 1].y - raw[0].y;
    const theta = Math.atan2(dy, dx);
    const cos = Math.cos(-theta), sin = Math.sin(-theta);
    const rot = raw.map((r) => ({
      stop: r.stop,
      x: r.x * cos - r.y * sin,
      y: r.x * sin + r.y * cos,
    }));

    const xs = rot.map((r) => r.x), ys = rot.map((r) => r.y);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const W = 900, PADX = 78, PADY = 52;
    const scale = x1 - x0 === 0 ? 1 : (W - PADX * 2) / (x1 - x0);
    const H = Math.round((y1 - y0) * scale) + PADY * 2;
    const cy = (H - (y1 - y0) * scale) / 2;
    return {
      W, H,
      //  Where true north points on the rotated page, in degrees clockwise
      //  from up - what the arrow is turned by.
      northDeg: (-theta * 180) / Math.PI + 90,
      pts: rot.map((r, i) => ({
        stop: r.stop,
        x: PADX + (xs[i] - x0) * scale,
        //  y inverted: latitude grows north, SVG y grows down.
        y: H - (cy + (ys[i] - y0) * scale),
      })),
    };
  }, [chain]);

  if (geom === null) return null;

  return (
    <section
      aria-label="Corridor map"
      className="rounded-lg border border-rule bg-surface p-4"
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="eyebrow">The corridor, to scale</h2>
        <span className="font-mono text-[10.5px] text-ink-mut">
          {chain[chain.length - 1]?.km.toFixed(1)} km · shaded by blocks placed
        </span>
      </div>

      <svg
        viewBox={`0 0 ${geom.W} ${geom.H}`}
        className="w-full"
        role="img"
        aria-label={`Corridor from ${chain[0]?.station.n} to ${chain[chain.length - 1]?.station.n}, ${chain[chain.length - 1]?.km.toFixed(1)} kilometres, with each section shaded by the number of blocks placed on it.`}
      >
        {/*  One segment per section, shaded by that section's pressure.  */}
        {plan.sections.map((sec, i) => {
          const a = geom.pts[i], b = geom.pts[i + 1];
          if (a === undefined || b === undefined) return null;
          const p = (blocksBySection.get(sec.id) ?? 0) / maxBlocks;
          const on = hover === sec.id;
          return (
            <g key={sec.id}>
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="var(--caution)"
                strokeOpacity={0.18 + p * 0.72}
                strokeWidth={on ? 15 : 11}
                strokeLinecap="round"
              />
              {/*  A wide invisible hit area: an 11px line is hard to hit.  */}
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="transparent" strokeWidth={26} strokeLinecap="round"
                className="cursor-pointer"
                onMouseEnter={() => setHover(sec.id)}
                onMouseLeave={() => setHover(null)}
              >
                <title>
                  {`${sec.name}\n${sec.kmFrom}–${sec.kmTo} km · ${(sec.kmTo - sec.kmFrom).toFixed(1)} km\n` +
                    `mean detention ${Math.round(pressure.get(sec.id) ?? 0)} min/slot\n` +
                    `${blocksBySection.get(sec.id) ?? 0} blocks in this plan`}
                </title>
              </line>
            </g>
          );
        })}

        {geom.pts.map((p, i) => (
          <g key={p.stop.station.c}>
            <circle
              cx={p.x} cy={p.y} r={5.5}
              fill="var(--surface)" stroke="var(--ink)" strokeWidth={2.5}
            />
            <text
              x={p.x}
              y={p.y - 14}
              textAnchor={i === 0 ? "start" : i === geom.pts.length - 1 ? "end" : "middle"}
              className="fill-[var(--ink)] font-mono text-[13px]"
            >
              {p.stop.station.c}
            </text>
            <text
              x={p.x}
              y={p.y + 25}
              textAnchor={i === 0 ? "start" : i === geom.pts.length - 1 ? "end" : "middle"}
              className="fill-[var(--ink-mut)] font-mono text-[11px]"
            >
              {p.stop.km.toFixed(1)}
            </text>
          </g>
        ))}
        {/*  True north on a rotated page, so the orientation is stated
             rather than quietly dropped.  */}
        <g transform={`translate(38 ${geom.H - 34}) rotate(${geom.northDeg})`}>
          <line x1={0} y1={13} x2={0} y2={-13} stroke="var(--ink-mut)" strokeWidth={1.5} />
          <path d="M0,-17 L4.5,-8 L-4.5,-8 Z" fill="var(--ink-mut)" />
        </g>
        <text
          x={38} y={geom.H - 6} textAnchor="middle"
          className="fill-[var(--ink-mut)] font-mono text-[10px]"
        >
          N
        </text>
      </svg>

      <p className="mt-1 max-w-[80ch] text-[12px] leading-relaxed text-ink-mut">
        Stops are placed by their published coordinates, so the spacing and the
        bend are real; the chainages below each stop are the same haversine
        distances the engine prices with. The line runs nearly due north, so it
        is drawn rotated onto its own axis — distances and the angle between
        stops are unchanged, and the arrow carries true north. Segments run
        straight between stops: the track&rsquo;s curvature is not something we
        hold, and we would rather show that than invent it.
      </p>
      <p className="mt-1.5 max-w-[80ch] text-[12px] leading-relaxed text-ink-mut">
        <strong className="font-semibold text-ink-mid">
          Detention is not what varies along this line.
        </strong>{" "}
        Mean cost differs by only {spread.bySection} min/slot between sections,
        against {spread.byHour} across the day — so <em>when</em> a block is
        taken matters far more than <em>where</em>, and the shading carries
        blocks placed instead. The heat strip on the planner is where the hourly
        variation is visible.
      </p>
    </section>
  );
}
