import type { ShortfallEntry } from "@/lib/plan";

/**
 * Statutory work that could not be accommodated.
 *
 * An optimiser that answers "INFEASIBLE" is useless in an operating railway.
 * When the backlog genuinely exceeds the corridor budget, the system returns a
 * plan PLUS this list - which item, its priced risk, and which constraint was
 * binding. That list is the artefact a DRM needs to argue for more block time
 * with evidence rather than assertion.
 */
export function ShortfallPanel({
  optimised,
  baseline,
}: {
  optimised: ShortfallEntry[];
  baseline: ShortfallEntry[];
}) {
  return (
    <section className="rounded-lg border border-rule bg-surface p-4">
      <h3 className="signal-rule eyebrow mb-1">Statutory shortfall</h3>
      <p className="mb-3 text-[11.5px] leading-relaxed text-ink-mut">
        Current practice misses {baseline.length}; the optimised plan misses{" "}
        {optimised.length}.
      </p>

      {optimised.length === 0 ? (
        <p className="rounded border border-go/30 bg-go-soft px-3 py-2 text-[12.5px] text-go">
          All statutory work accommodated this horizon — proven, not penalised.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {optimised.map((s) => (
            <li
              key={s.taskId}
              className="rounded border border-danger/25 bg-danger-soft px-3 py-2"
            >
              <p className="font-mono text-[12px] font-medium text-ink">
                {s.taskId}{" "}
                <span className="text-ink-mut">
                  crit-{s.criticality} · ρ {s.riskRate}/slot
                </span>
              </p>
              <p className="mt-0.5 text-[11.5px] text-ink-mid">
                Binding: {s.bindingConstraint}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
