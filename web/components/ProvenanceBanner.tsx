import Link from "next/link";
import type { PlanPayload } from "@/lib/plan";

/**
 * Declared before anyone asks.
 *
 * TMS, SMMS, TDMS, COA and BDMS are internal Indian Railways systems with no
 * external access, so the maintenance backlog is generated. Saying so in the
 * interface - rather than in a footnote someone finds later - is the whole
 * point. Declared synthetic beats discovered synthetic.
 */
export function ProvenanceBanner({ provenance }: { provenance: PlanPayload["provenance"] }) {
  return (
    <div className="border-b border-caution/30 bg-caution-soft">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-baseline gap-x-3 gap-y-1 px-6 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-caution">
          Data notice
        </span>
        <p className="max-w-[92ch] text-[12.5px] leading-relaxed text-ink-mid">
          {provenance.notice}
        </p>
        {provenance.seed !== null && (
          <span className="font-mono text-[11px] text-ink-mut">
            seed {provenance.seed}
            {provenance.pricedBy.length > 0 &&
              ` · priced by ${provenance.pricedBy.join(", ")}`}
          </span>
        )}
        <Link
          href="/limits"
          className="font-mono text-[11px] text-caution underline underline-offset-2 hover:text-ink"
        >
          full limitations →
        </Link>
      </div>
    </div>
  );
}
