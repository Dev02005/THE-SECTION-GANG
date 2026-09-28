import { DEPT_LABEL, type Department } from "@/lib/plan";
import type { MonthlyPayload } from "@/lib/monthly";

const DEPT_VAR: Record<Department, string> = {
  ENGG: "var(--engg)",
  SNT: "var(--snt)",
  TRD: "var(--trd)",
};

const RESOURCE_LABEL: Record<string, string> = {
  TOWER_WAGON: "Tower wagon",
  TAMPER: "Tamper",
  USFD: "USFD units",
  GANG: "P.Way gangs",
  SNT_CREW: "S&T crews",
  TRD_CREW: "TRD crews",
};

/** At or above this share of its week a resource is shown as full. */
const FULL = 98;

function Bar({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div aria-hidden="true" className="mt-1 h-1.5 w-full rounded-full bg-surface-sunk">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(100, pct)}%`, background: tone }}
      />
    </div>
  );
}

/*  Both scroll boxes are `relative` on purpose: the chips' screen-reader labels
    are absolutely positioned, and an absolute element escapes a scroll box that
    is not itself positioned - they sat out at the table's full width and made
    the whole page scroll sideways at 360px.  */

/** Sections down, weeks across: corridor hours used of available, and who works. */
export function MonthGrid({ m }: { m: MonthlyPayload }) {
  const cell = (sid: string, wk: number) =>
    m.cells.find((c) => c.section === sid && c.week === wk);
  return (
    <div className="relative overflow-x-auto rounded-lg border border-rule bg-surface">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <caption className="sr-only">
          Corridor hours used of available, per section and week
        </caption>
        <thead>
          <tr className="border-b border-rule">
            <th className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-mut">
              Section
            </th>
            {m.weeks.map((w) => (
              <th
                key={w.week}
                className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-mut"
              >
                Week {w.week}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.sections.map((s) => (
            <tr key={s.id} className="border-b border-rule-soft align-top">
              <th scope="row" className="px-3 py-2.5 text-left font-normal">
                <span className="font-mono text-[12px] text-ink">{s.id}</span>
                <br />
                <span className="text-[11.5px] text-ink-mut">{s.name}</span>
              </th>
              {m.weeks.map((w) => {
                const c = cell(s.id, w.week);
                if (!c) return <td key={w.week} />;
                const pct = c.corridorHours ? (100 * c.blockHours) / c.corridorHours : 0;
                return (
                  <td key={w.week} className="px-3 py-2.5">
                    <span className="tnum font-mono text-[12.5px] text-ink">
                      {c.blockHours} / {c.corridorHours} h
                    </span>
                    <Bar pct={pct} tone={pct >= FULL ? "var(--caution)" : "var(--accent)"} />
                    <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-mid">
                      <span className="tnum">{c.jobs} jobs</span>
                      {c.depts.map((d) => (
                        <span
                          key={d}
                          title={DEPT_LABEL[d]}
                          className="inline-block h-2.5 w-2.5 rounded-sm"
                          style={{ background: DEPT_VAR[d] }}
                        >
                          <span className="sr-only">{DEPT_LABEL[d]}</span>
                        </span>
                      ))}
                      {c.statutory > 0 && (
                        <span className="tnum text-ink-mut">· {c.statutory} statutory</span>
                      )}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="bg-surface-sunk/50">
            <th scope="row" className="px-3 py-2 text-left font-mono text-[11px] text-ink-mut">
              Week total
            </th>
            {m.weeks.map((w) => (
              <td key={w.week} className="tnum px-3 py-2 font-mono text-[12px] text-ink">
                {w.jobs} jobs · {w.statutory} statutory · {w.blockHours} h
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Each shared resource's hours against what one block per corridor allows. */
export function ResourceTable({ m }: { m: MonthlyPayload }) {
  const names = Object.keys(m.weeks[0]?.resources ?? {});
  return (
    <div className="relative overflow-x-auto rounded-lg border border-rule bg-surface">
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <caption className="sr-only">Resource hours used of available, per week</caption>
        <thead>
          <tr className="border-b border-rule">
            <th className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-mut">
              Resource
            </th>
            {m.weeks.map((w) => (
              <th
                key={w.week}
                className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-mut"
              >
                Week {w.week}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((r) => (
            <tr key={r} className="border-b border-rule-soft last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                {RESOURCE_LABEL[r] ?? r}
              </th>
              {m.weeks.map((w) => {
                const u = w.resources[r];
                const full = u.pct >= FULL;
                return (
                  <td key={w.week} className="px-3 py-2">
                    <span className={`tnum font-mono text-[12px] ${full ? "font-bold text-ink" : "text-ink-mid"}`}>
                      {u.pct}%{full ? " · full" : ""}
                    </span>
                    <Bar pct={u.pct} tone={full ? "var(--caution)" : "var(--go)"} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
