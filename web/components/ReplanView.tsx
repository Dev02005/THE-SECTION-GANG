"use client";

import { useMemo } from "react";
import type { PlanPayload } from "@/lib/plan";
import { type ReplanPayload, replanMatches } from "@/lib/replan";
import { type ChartRow, TimeDistanceChart } from "@/components/planner/TimeDistanceChart";
import { Legend } from "@/components/planner/Legend";

/**
 * One disruption, and what the plan does about it.
 *
 * Read top to bottom the way a DRM would ask: what happened, is it dealt with,
 * what did that cost the rest of the week, and could the cost have been
 * avoided. The last question is the one no replanner in the field answers, and
 * it is answered here by re-solving - not by assertion.
 *
 * Every figure is read from replan.json, which the engine wrote after checking
 * it was replanning the week that actually shipped.
 */
export function ReplanView({
  plan,
  replan,
}: {
  plan: PlanPayload;
  replan: ReplanPayload | null;
}) {
  const rows: ChartRow[] = useMemo(
    () => plan.sections.flatMap((s) => plan.roads.map((road) => ({ section: s.id, road }))),
    [plan],
  );

  if (replan === null) {
    return (
      <Note>
        No replan has been built for this plan. It is produced offline by{" "}
        <code className="font-mono">python -m engine.build_replan</code>.
      </Note>
    );
  }
  if (!replanMatches(replan, plan)) {
    return (
      <Note>
        The precomputed scenario belongs to a different plan from the one you
        are looking at, so it is not shown. A disruption response only means
        something against the week it was computed for.
      </Note>
    );
  }

  const r = replan.result;
  const d = replan.disruption;
  const u = replan.urgent;
  const dd = replan.diff;
  const futureApproved = dd.kept.length + dd.changed.length + dd.dropped.length;
  const helps = replan.counterfactuals.filter((c) => c.avoidsTheLoss);
  const doesNot = replan.counterfactuals.filter((c) => !c.avoidsTheLoss);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="eyebrow mb-1.5">Precomputed scenario · one disruption</p>
        <h1 className="text-[26px] font-bold">When the week does not go to plan</h1>
      </header>

      <section aria-label="What happened" className="rounded-lg border border-caution bg-caution-soft p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink">
          {d.atLabel} · {d.section} {d.line}
        </p>
        <p className="mt-1 text-[15px] leading-relaxed text-ink">
          {d.description}: <strong>{d.activity}</strong>, needing{" "}
          {Object.keys(d.resources).join(" and ")}. It must be removed by{" "}
          <strong>{d.dueLabel}</strong>.
        </p>
        {replan.blackoutDays.length > 0 && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-mid">
            {replan.blackoutDays.join(", ")} is a blackout day — no block is
            permitted — so within the {d.hoursToDue}-hour deadline a block can
            only be taken on {d.workableDays.join(" or ")}.
          </p>
        )}
      </section>

      <section aria-label="Result" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Flaw removed"
          value={u.scheduled ? `${u.startLabel}–${u.endLabel?.slice(-5)}` : "not possible"}
          note={
            u.scheduled && !dd.added.length
              ? "inside a block already granted — no new block"
              : u.scheduled ? "in a new block" : "infeasible by its deadline"
          }
        />
        <Stat
          label="Approved blocks ahead unchanged"
          value={`${dd.kept.length} of ${futureApproved}`}
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

      {replan.lost.length > 0 && (
        <section aria-label="What it cost" className="rounded-lg border border-rule bg-surface p-4">
          <h2 className="eyebrow mb-2">What it cost, and why it was unavoidable</h2>
          {replan.lost.map((l) => (
            <p key={l.tid} className="text-[13.5px] leading-relaxed text-ink">
              <strong className="font-mono">{l.tid}</strong> — {l.activity} on{" "}
              {l.section}, due {l.dueLabel} — is deferred. No plan that removes
              the flaw on time keeps it: the statutory count above is a proven
              maximum. Before its deadline its section has{" "}
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
              {helps
                .map((c) => `one more ${c.resource.toLowerCase()} (${c.from} → ${c.to})`)
                .join(" or ")}{" "}
              and nothing is lost —{" "}
              {helps[0].minChanges === 0
                ? "the flaw fits with no change at all to the approved week"
                : `${helps[0].minChanges} approved job(s) change`}
              .
            </p>
          )}
          {doesNot.length > 0 && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-mut">
              Tried and not enough on its own:{" "}
              {doesNot.map((c) => `one more ${c.resource.toLowerCase()}`).join(", ")}.
            </p>
          )}
        </section>
      )}

      <TimeDistanceChart
        plan={plan}
        blocks={plan.optimised.blocks}
        rows={rows}
        title="As approved"
        subtitle={`${plan.optimised.blocks.length} blocks`}
        marker={{ slot: d.atSlot, label: `flaw found ${d.atLabel}` }}
      />
      <TimeDistanceChart
        plan={plan}
        blocks={replan.replannedBlocks}
        rows={rows}
        title="After the replan"
        subtitle={`${replan.replannedBlocks.length} blocks · the flaw's block outlined`}
        selectedId={u.window}
        marker={{ slot: d.atSlot, label: `flaw found ${d.atLabel}` }}
      />
      <Legend />

      <section aria-label="Changes" className="grid gap-4 lg:grid-cols-2">
        <List title="Approved jobs deferred" items={dd.tasksDeferred} empty="none" />
        <List
          title="Approved jobs moved"
          items={dd.tasksMoved.map((m) => `${m.task}: ${m.from} → ${m.to}`)}
          empty="none"
        />
        <List title="Deferred jobs now picked up" items={dd.tasksPickedUp} empty="none" />
        <List title="Approved blocks no longer needed" items={dd.dropped} empty="none" />
      </section>

      <p className="justified max-w-[80ch] text-[12.5px] leading-relaxed text-ink-mut">
        How it decides, in order: keep every statutory job that can be kept;
        then change as few approved jobs as possible; then be as cheap as
        possible. Blocks already executed are frozen as they ran. This is one
        disruption, re-solved offline in {r.wallTimeS} seconds and precomputed so
        it cannot fail on stage — it is not a live feed, and continuous
        replanning remains designed, not built.
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

function List({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-lg border border-rule bg-surface p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mut">
        {title} · {items.length}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-ink-mut">{empty}</p>
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

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="justified max-w-[70ch] rounded-lg border border-rule px-4 py-3 text-[13.5px] leading-relaxed text-ink-mid">
      {children}
    </p>
  );
}
