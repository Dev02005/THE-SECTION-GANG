import type { PlanPayload } from "@/lib/plan";
import type { ReplanScenario } from "@/lib/replan";
import { type ChartRow, TimeDistanceChart } from "@/components/planner/TimeDistanceChart";
import { Legend } from "@/components/planner/Legend";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOTS_DAY = 96;

//  How an officer names each resource - not the code's constant.
const NAME: Record<string, string> = {
  TOWER_WAGON: "tower wagon",
  TAMPER: "tamper",
  USFD: "USFD unit",
  GANG: "gang",
  SNT_CREW: "S&T crew",
  TRD_CREW: "TRD crew",
};
const res = (r: string) => NAME[r] ?? r.replace(/_/g, " ").toLowerCase();
//  By sound, not spelling: "a USFD unit" (you-ess), "an S&T crew" (ess).
const article = (r: string) => (r === "SNT_CREW" ? "an" : "a");

/**
 * One disruption, and what the plan does about it.
 *
 * Read top to bottom the way a DRM would ask: what happened, is it dealt with,
 * what did that cost the rest of the week, and could the cost have been
 * avoided. When the job cannot be dealt with by its deadline at all, the page
 * says so - and still answers the last question, because a re-solve with one
 * more of each resource shows whether money or time is the limit.
 */
export function ScenarioView({
  plan,
  sc,
  rows,
  blackoutDays,
}: {
  plan: PlanPayload;
  sc: ReplanScenario;
  rows: ChartRow[];
  blackoutDays: string[];
}) {
  const d = sc.disruption;
  const r = sc.result;
  const u = sc.urgent;
  const dd = sc.diff;
  const helps = sc.counterfactuals.filter((c) => c.avoidsTheLoss);
  const doesNot = sc.counterfactuals.filter((c) => !c.avoidsTheLoss);
  //  A blackout matters only if it falls between the disruption and its deadline.
  const spanned = new Set<string>();
  for (let day = Math.floor(d.atSlot / SLOTS_DAY); day * SLOTS_DAY < d.dueSlot; day++) {
    spanned.add(DAYS[day % 7]);
  }
  const blackoutHere = blackoutDays.filter((x) => spanned.has(x));
  const marker = { slot: d.atSlot, label: `fault found ${d.atLabel}` };

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="What happened" className="rounded-lg border border-caution bg-caution-soft p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink">
          {d.atLabel} · {d.section} {d.line}
        </p>
        <p className="mt-1 text-[15px] leading-relaxed text-ink">
          {d.description}: <strong>{d.activity}</strong>, needing{" "}
          {Object.keys(d.resources).map((r) => `${article(r)} ${res(r)}`).join(" and ")}. It must be dealt
          with by <strong>{d.dueLabel}</strong>, {d.hoursToDue} hours later.
        </p>
        {blackoutHere.length > 0 && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-mid">
            {blackoutHere.join(", ")} is a blackout day &mdash; no block is
            permitted &mdash; so within the deadline a block can only be taken
            on {d.workableDays.join(" or ")}.
          </p>
        )}
      </section>

      {!sc.feasible || dd === null ? (
        <section aria-label="Cannot be done in time" className="rounded-lg border border-danger bg-danger-soft p-4">
          <h2 className="eyebrow mb-2">It cannot be dealt with by its deadline</h2>
          <p className="text-[14px] leading-relaxed text-ink">
            Proven, not estimated: with the blocks already worked frozen as they
            ran, no plan fits {d.activity.toLowerCase()} ({d.bookedSlots * 15}{" "}
            minutes booked) on {d.section} before {d.dueLabel}. The replan
            refuses rather than quietly leaving it undone.
          </p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink">
            {helps.length > 0 ? (
              <>
                <strong>What would make it possible, found by re-solving:</strong>{" "}
                {helps.map((c) => `one more ${res(c.resource)} (${c.from} → ${c.to})`).join(" or ")}.
              </>
            ) : (
              <>
                One more of each resource it needs (
                {sc.counterfactuals.map((c) => res(c.resource)).join(", ")}) was
                tried, and neither makes it possible &mdash; so the limit is not
                the machines or crews but the permitted windows before the
                deadline. This is the case for an emergency speed restriction
                until a block can be taken.
              </>
            )}
          </p>
        </section>
      ) : (
        <>
          <section aria-label="Result" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Dealt with"
              value={u.scheduled ? `${u.startLabel}–${u.endLabel?.slice(-5)}` : "not possible"}
              note={u.scheduled && !dd.added.length
                ? "inside a block already granted — no new block"
                : "in a new block"}
            />
            <Stat
              label="Approved blocks ahead unchanged"
              value={`${dd.kept.length} of ${dd.kept.length + dd.changed.length + dd.dropped.length}`}
              note={`${r.frozenBlocks} already executed, frozen as they ran`}
            />
            <Stat
              label="Approved jobs changed"
              value={String(r.minChanges ?? "—")}
              note={r.minChangesProven ? "proven to be the fewest possible" : "the fewest found"}
            />
            <Stat
              label="Statutory jobs kept"
              value={String(r.statutoryKept ?? "—")}
              note={r.statutoryProven ? "proven maximum" : "the most found"}
            />
          </section>

          {sc.lost.length > 0 && (
            <section aria-label="What it cost" className="rounded-lg border border-rule bg-surface p-4">
              <h2 className="eyebrow mb-2">What it cost, and why it was unavoidable</h2>
              {sc.lost.map((l) => (
                <p key={l.tid} className="text-[13.5px] leading-relaxed text-ink">
                  <strong className="font-mono">{l.tid}</strong> — {l.activity} on{" "}
                  {l.section}, due {l.dueLabel} — is deferred. No plan that deals
                  with the fault on time keeps it: the statutory count above is a
                  proven maximum. Before its deadline its section has{" "}
                  {l.windowsBeforeDue} candidate windows, all on{" "}
                  {l.windowDays.join(", ")}
                  {l.blackoutDaysBeforeDue.length > 0 &&
                    `, because ${l.blackoutDaysBeforeDue.join(", ")} is a blackout`}
                  .
                </p>
              ))}
              {helps.length > 0 && (
                <p className="mt-2.5 rounded bg-accent-soft px-3 py-2 text-[13.5px] leading-relaxed text-ink">
                  <strong style={{ color: "var(--accent)" }}>The fix, proven by re-solving:</strong>{" "}
                  {helps.map((c) => `one more ${res(c.resource)} (${c.from} → ${c.to})`).join(" or ")}{" "}
                  and nothing is lost —{" "}
                  {helps[0].minChanges === 0
                    ? "the job fits with no change at all to the approved week"
                    : `${helps[0].minChanges} approved job(s) change`}
                  .
                </p>
              )}
              {doesNot.length > 0 && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-mut">
                  Tried and not enough on its own:{" "}
                  {doesNot.map((c) => `one more ${res(c.resource)}`).join(", ")}.
                </p>
              )}
            </section>
          )}
        </>
      )}

      <TimeDistanceChart
        plan={plan}
        blocks={plan.optimised.blocks}
        rows={rows}
        title="As approved"
        subtitle={`${plan.optimised.blocks.length} blocks`}
        marker={marker}
      />
      {sc.feasible && dd !== null && (
        <>
          <TimeDistanceChart
            plan={plan}
            blocks={sc.replannedBlocks}
            rows={rows}
            title="After the replan"
            subtitle={`${sc.replannedBlocks.length} blocks · the job's block outlined`}
            selectedId={u.window}
            marker={marker}
          />
          <section aria-label="Changes" className="grid gap-4 lg:grid-cols-2">
            <List title="Approved jobs deferred" items={dd.tasksDeferred} />
            <List title="Approved jobs moved"
              items={dd.tasksMoved.map((m) => `${m.task}: ${m.from} → ${m.to}`)} />
            <List title="Deferred jobs now picked up" items={dd.tasksPickedUp} />
            <List title="Approved blocks no longer needed" items={dd.dropped} />
          </section>
        </>
      )}
      <Legend />

      <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-ink-mut">
        How it decides, in order: the job is required, not priced; then keep
        every statutory job that can be kept; then change as few approved jobs
        as possible; then be as cheap as possible. Blocks already worked are
        frozen as they ran. Re-solved offline in {r.wallTimeS} seconds and
        precomputed so it cannot fail on stage &mdash; not a live feed:
        continuous replanning remains designed, not built.
      </p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-rule bg-surface p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mut">{label}</p>
      <p className="tnum mt-1 text-[20px] font-bold text-ink">{value}</p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-ink-mut">{note}</p>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-rule bg-surface p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mut">
        {title} · {items.length}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-ink-mut">none</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5">
          {items.map((i) => (
            <li key={i} className="font-mono text-[12px] text-ink-mid">{i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
