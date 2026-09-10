import { formatSigned, type Kpis, type Deltas } from "./plan";

/**
 * The landing page's comparison table, as data.
 *
 * Nine rows, every one of them read off the artefact rather than restated -
 * the same rule the rest of the site follows, and the reason regenerating the
 * plan changes this table without anyone editing it.
 *
 * It lives here rather than inside the page component because it is a
 * transformation of the plan, not a piece of layout, and because the page was
 * over the 300-line standard with it inline.
 */
export interface Row {
  label: string;
  before: string;
  after: string;
  delta: string;
  /** The signed change, for colouring. Null where the change is not a number. */
  raw: number | null;
  lowerIsBetter: boolean;
}

/** Semantic colour must follow the truth: a regression has to look like one. */
export function tone(value: number | null, lowerIsBetter: boolean): string {
  if (value === null || value === 0) return "text-ink-mut";
  const improved = lowerIsBetter ? value < 0 : value > 0;
  return improved ? "text-go" : "text-danger";
}

export function comparisonRows(kpis: {
  baseline: Kpis;
  optimised: Kpis;
  deltas: Deltas;
}): Row[] {
  const b = kpis.baseline;
  const o = kpis.optimised;
  const d = kpis.deltas;

  return [
    {
      label: "Blocks granted",
      before: String(b.blocks),
      after: String(o.blocks),
      delta: formatSigned(d.blocks_pct),
      raw: d.blocks_pct,
      lowerIsBetter: true,
    },
    {
      label: "Block-hours on line",
      before: b.block_hours.toFixed(1),
      after: o.block_hours.toFixed(1),
      delta: formatSigned(d.block_hours_pct),
      raw: d.block_hours_pct,
      lowerIsBetter: true,
    },
    {
      label: "Train detention (min)",
      before: b.detention_minutes.toLocaleString(),
      after: o.detention_minutes.toLocaleString(),
      delta: formatSigned(d.detention_pct),
      raw: d.detention_pct,
      lowerIsBetter: true,
    },
    {
      label: "Detention per task done",
      before: b.detention_per_task.toFixed(1),
      after: o.detention_per_task.toFixed(1),
      delta: formatSigned(d.detention_per_task_pct),
      raw: d.detention_per_task_pct,
      lowerIsBetter: true,
    },
    {
      label: "Residual risk carried",
      before: b.risk_carried.toLocaleString(),
      after: o.risk_carried.toLocaleString(),
      delta: formatSigned(d.risk_carried_pct),
      raw: d.risk_carried_pct,
      lowerIsBetter: true,
    },
    {
      label: "Tasks completed",
      before: String(b.scheduled),
      after: String(o.scheduled),
      delta: formatSigned(d.throughput_pct),
      raw: d.throughput_pct,
      lowerIsBetter: false,
    },
    //  The last three report a change that is not a percentage, so they carry
    //  no delta and no colour rather than a number dressed up as one.
    {
      label: "Statutory closed",
      before: d.statutory_before,
      after: d.statutory_after,
      delta: "",
      raw: null,
      lowerIsBetter: false,
    },
    {
      label: "Multi-department blocks",
      before: `${b.multidept_pct}%`,
      after: `${o.multidept_pct}%`,
      delta: "",
      raw: null,
      lowerIsBetter: false,
    },
    {
      label: "Packing (work-hr / block-hr)",
      before: b.packing.toFixed(2),
      after: o.packing.toFixed(2),
      delta: `${d.packing_ratio}×`,
      //  A ratio of 1.0 is no change, which is why the tone is taken from
      //  ratio - 1 rather than from the ratio itself.
      raw: d.packing_ratio - 1,
      lowerIsBetter: false,
    },
  ];
}
