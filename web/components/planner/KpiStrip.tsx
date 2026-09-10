import type { Deltas, Kpis } from "@/lib/plan";
import { tone } from "@/lib/comparison";
import { formatSigned } from "@/lib/plan";



/**
 * The comparison in nine numbers. Both sides come from one scoring function on
 * one instance - there is no per-side constant to tilt.
 */
export function KpiStrip({
  baseline,
  optimised,
  deltas,
}: {
  baseline: Kpis;
  optimised: Kpis;
  deltas: Deltas;
}) {
  const items = [
    { l: "Blocks", b: baseline.blocks, o: optimised.blocks, d: deltas.blocks_pct, lower: true },
    { l: "Block-hours", b: baseline.block_hours, o: optimised.block_hours, d: deltas.block_hours_pct, lower: true },
    { l: "Detention / task", b: baseline.detention_per_task, o: optimised.detention_per_task, d: deltas.detention_per_task_pct, lower: true },
    { l: "Risk carried", b: baseline.risk_carried, o: optimised.risk_carried, d: deltas.risk_carried_pct, lower: true },
    { l: "Tasks done", b: baseline.scheduled, o: optimised.scheduled, d: deltas.throughput_pct, lower: false },
    { l: "Packing", b: baseline.packing, o: optimised.packing, d: (deltas.packing_ratio - 1) * 100, lower: false },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-3 lg:grid-cols-6">
      {items.map((i) => (
        <div key={i.l} className="bg-surface px-3 py-2.5">
          <p className="eyebrow mb-1 truncate">{i.l}</p>
          <p className="tnum font-mono text-[15px] font-medium leading-none text-ink">
            {i.o.toLocaleString()}
          </p>
          <p className="tnum mt-1 font-mono text-[11px] text-ink-mut">
            from {i.b.toLocaleString()}{" "}
            <span className={tone(i.d, i.lower)}>{formatSigned(i.d)}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
