"use client";

import type { DbDivisionRow } from "@/lib/db";

/**
 * The divisions of a zone, and what each one holds.
 *
 * A zonal post is entitled to every plan in its zone, and until now it was
 * handed exactly one of them with nothing to say the others existed. This is
 * the missing half: the whole zone, one row each, and a way to open any of
 * them.
 *
 * Divisions with no plan are shown, not hidden. Two of East Coast
 * Railway's three divisions hold nothing, and a General Manager knowing which
 * two is the entire value of looking at this level. A list that quietly
 * dropped them would read as though the zone were fully planned.
 */
export function ZoneDivisions({
  rows,
  selected,
  onSelect,
}: {
  rows: DbDivisionRow[];
  /** null means "whichever plan is newest", the default a GM lands on. */
  selected: string | null;
  onSelect: (code: string | null) => void;
}) {
  if (rows.length === 0) return null;

  const held = rows.filter((r) => r.plan_id !== null).length;

  return (
    <section
      aria-label="Divisions in this zone"
      className="mb-5 rounded-lg border border-rule bg-surface p-3"
    >
      <p className="mb-2.5 flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-mut">
          Divisions in this zone
        </span>
        <span className="text-[12.5px] text-ink-mid">
          {held} of {rows.length}{" "}
          {held === 1 ? "holds a plan" : "hold a plan"}
        </span>
      </p>

      <div className="flex flex-wrap gap-2">
        {rows.map((r) => {
          const has = r.plan_id !== null;
          const on = selected === r.division_code;
          return (
            <button
              key={r.division_code}
              type="button"
              aria-pressed={on}
              //  A division with no plan is not a dead button: pressing it
              //  shows the "no plan held" panel naming that division, which is
              //  the honest answer and the one worth being able to reach.
              onClick={() => onSelect(on ? null : r.division_code)}
              className={`rounded border px-3 py-2 text-left transition-colors ${
                on
                  ? "border-accent bg-accent-soft"
                  : "border-rule hover:border-ink-mut"
              }`}
            >
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[13px] font-medium text-ink">
                  {r.division_name}
                </span>
                <span className="font-mono text-[10.5px] text-ink-mut">
                  {r.division_code}
                </span>
              </span>
              <span className="mt-0.5 block font-mono text-[11px] text-ink-mut">
                {has ? (
                  <>
                    {r.blocks} blocks · statutory {r.statutory_done}/
                    {r.statutory_total} · {r.status}
                  </>
                ) : (
                  "no plan held"
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
