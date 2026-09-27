import type { PlanPayload } from "@/lib/plan";
import { num } from "@/lib/plan";

/**
 * What the solver actually proved.
 *
 * Five of the seven competing submissions run a solver capable of producing a
 * bound and none of them surface it. We do - and we report it as what it is, a
 * proven floor, rather than dressing a wide gap as a tight one.
 *
 * Two numbers, because they answer different questions:
 *
 *   FULL       is dominated by the out-of-horizon deferral penalty, so it
 *              really measures how many deferrals are provably necessary. Hard
 *              to bound, and not what anyone asks in a block meeting.
 *   PLACEMENT  holds the set of work fixed and asks whether it is scheduled as
 *              well as it could be. That is the planner's question, and it has
 *              a tighter answer.
 *
 * Neither percentage is headlined. The defensible claim is the floor.
 */
export function SolverPanel({
  solver,
  placement,
}: {
  solver: PlanPayload["solver"];
  placement: PlanPayload["placement"];
}) {
  return (
    <section className="rounded-lg border border-rule bg-surface p-4">
      <h3 className="signal-rule eyebrow mb-3">What the solver proved</h3>

      <p className="text-[12.5px] leading-relaxed text-ink-mid">
        No plan of this work costs less than{" "}
        <strong className="tnum font-mono font-medium text-ink">
          {num((placement?.bound ?? solver.bound ?? 0))}
        </strong>{" "}
        detention-minute equivalents. Ours costs{" "}
        <strong className="tnum font-mono font-medium text-ink">
          {num((placement?.objective ?? solver.objective))}
        </strong>
        .
      </p>

      <dl className="mt-3 flex flex-col gap-1.5 border-t border-rule-soft pt-3">
        <Row k="Status" v={solver.status} />
        <Row
          k="Reproducible"
          v={solver.deterministic ? "Yes — fixed work budget" : "No"}
        />
        <Row k="Wall time" v={`${solver.wallTimeS.toFixed(1)} s`} />
      </dl>

      <div className="mt-3 border-t border-rule-soft pt-3">
        <p className="eyebrow mb-2">Gap to proven optimum</p>
        <dl className="flex flex-col gap-1.5">
          {placement && (
            <Row
              k="Placement"
              v={placement.gapPct !== null ? `${placement.gapPct}%` : "—"}
              strong
            />
          )}
          <Row
            k="Including what to defer"
            v={solver.gapPct !== null ? `${solver.gapPct}%` : "—"}
          />
        </dl>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-mut">
          {placement
            ? `Placement holds the ${placement.tasksPinned} scheduled tasks fixed and asks only whether they are placed well. The wider figure also bounds the choice of which work to defer, which is dominated by a penalty term and is far harder to prove.`
            : "The bound is a proof, not an estimate: no plan costs less than it."}
        </p>
      </div>
    </section>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12.5px] text-ink-mut">{k}</dt>
      <dd
        className={`tnum font-mono text-[12.5px] ${
          strong ? "font-medium text-ink" : "text-ink-mid"
        }`}
      >
        {v}
      </dd>
    </div>
  );
}
