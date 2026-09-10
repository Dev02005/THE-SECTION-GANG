import Link from "next/link";
import { ProvenanceBanner } from "@/components/ProvenanceBanner";
import { SiteHeader } from "@/components/SiteHeader";
import { loadPlan } from "@/lib/loadPlan";
import { comparisonRows, tone } from "@/lib/comparison";

export const dynamic = "force-static";

export default async function Home() {
  const plan = await loadPlan();
  const { kpis, solver, provenance } = plan;
  const o = kpis.optimised;

  const rows = comparisonRows(kpis);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Corridor — Automatic Block Planning",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Joint maintenance block planning for Indian Railways. Prices asset risk " +
      "and train detention in one unit, then buys the most risk reduction per " +
      "minute of line occupation across Engineering, S&T and Traction.",
    author: { "@type": "Organization", name: "Team Corridor" },
    about: {
      "@type": "Thing",
      name: "Railway maintenance block planning",
    },
    isAccessibleForFree: true,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />
      <ProvenanceBanner provenance={provenance} />

      <main className="justified mx-auto w-full max-w-[1400px] flex-1 px-6 pb-10">
        {/* ---- thesis ---- */}
        {/* graph paper behind the thesis - the surface a block plan is drawn on */}
        <section className="max-w-[92ch] border-b border-rule py-14">
          <p className="eyebrow mb-5">
            SIH26027 · Ministry of Railways · Smart India Hackathon 2026
          </p>
          {/*  The measure has to hold "One corridor. One plan." on one line, or
               the break lands mid-phrase and the three beats stop reading as
               three. 24ch is that line plus a little air.  */}
          <h1 className="text-[clamp(2rem,5vw,3.6rem)] font-bold leading-[1.04]">
            Three registers.
            <br />
            One corridor. One plan.
          </h1>
          <p className="mt-6 text-[17px] leading-relaxed text-ink-mid">
            Engineering, S&amp;T and Traction each keep their own maintenance
            register, and each asks the corridor for time separately. Nothing in
            the present process puts the three in front of a division together,
            so work that could travel in one block is granted as three.
          </p>
          <p className="mt-4 text-[17px] leading-relaxed text-ink-mid">
            Corridor plans them jointly. Asset risk and train detention are
            priced in one unit —{" "}
            <strong className="font-semibold text-ink">
              detention-minute equivalents
            </strong>{" "}
            — so an overdue rail flaw and an overdue signal lamp can be weighed
            against the traffic each block would hold up. The plan then takes the
            work that removes the most risk for the least line occupation.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/planner"
              className="rounded-md bg-accent px-5 py-2.5 text-[14px] font-medium text-accent-ink transition-opacity hover:opacity-90"
            >
              Open the planner
            </Link>
            <Link
              href="/method"
              className="rounded-md border border-rule px-5 py-2.5 text-[14px] font-medium text-ink transition-colors hover:bg-surface-sunk"
            >
              How it decides
            </Link>
          </div>
        </section>

        {/* ---- the structural problem ---- */}
        <section className="grid gap-8 border-b border-rule py-14 md:grid-cols-3">
          {[
            {
              h: "No department sees the other two",
              p: "Engineering logs defects in TMS, S&T in SMMS, Traction in TDMS. The three do not meet in any system, so none can propose sharing a block even where it would obviously help. That is structural, not negligence.",
            },
            {
              h: "Availability is not cost",
              p: "A block at 07:30 and a block at 02:30 both appear free in the corridor. They are nothing alike in the detention they cause, and nothing in the current process prices the difference.",
            },
            {
              h: "Priorities do not compare",
              p: "Each register is worked most-overdue-first. But an overdue signal lamp and an overdue rail flaw are not comparable risks, and there is no shared unit to compare them in.",
            },
          ].map((c) => (
            <div key={c.h}>
              <h2 className="mb-2 text-[17px] font-semibold text-ink">{c.h}</h2>
              <p className="text-[14.5px] leading-relaxed text-ink-mid">{c.p}</p>
            </div>
          ))}
        </section>

        {/* ---- the measured result ---- */}
        <section className="py-14">
          {/*  The note used to sit in a second column beside the heading, where
               it read as a caption to nothing. It belongs under the heading it
               qualifies, on the same measure as the table below.  */}
          <div className="mb-6">
            <p className="eyebrow mb-2">The measured result</p>
            <h2 className="text-[28px] font-bold">
              Current practice versus the optimised plan
            </h2>
            <p className="mt-2.5 max-w-[76ch] text-[13.5px] leading-relaxed text-ink-mut">
              Every figure below is computed from the plan the engine produced —
              none of it is written in by hand. Both plans are scored by one
              function on one instance, with the same detention surface, the
              same risk prices and the same booked durations, and the baseline
              books the same P90 the optimiser books.
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
            <table className="w-full min-w-[640px] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-rule">
                  {["Metric", "Current practice", "Optimised", "Change"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={`px-4 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-ink-mut ${
                          i === 0 ? "text-left" : "text-right"
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-rule-soft last:border-0">
                    <td className="px-4 py-2.5 text-ink-mid">{r.label}</td>
                    <td className="tnum px-4 py-2.5 text-right font-mono text-ink-mut">
                      {r.before}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right font-mono font-medium text-ink">
                      {r.after}
                    </td>
                    <td
                      className={`tnum px-4 py-2.5 text-right font-mono font-medium ${tone(r.raw, r.lowerIsBetter)}`}
                    >
                      {r.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ---- what the solver actually proved ---- */}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Stat
              label="Solver status"
              value={solver.status}
              note={
                solver.deterministic
                  ? "Deterministic — identical plan every run"
                  : "Free-running portfolio"
              }
            />
            <Stat
              label="Statutory obligation"
              value={solver.statutoryProven ? "Proven" : `${o.statutory_done}/${o.statutory_total}`}
              note={
                solver.statutoryProven
                  ? "Every criticality-A task placed, as a hard constraint"
                  : "Shortfall list names the binding constraint for each"
              }
            />
            <Stat
              label="Clubbed blocks"
              value={`${o.multidept_pct}%`}
              note={`${o.multidept_blocks} of ${o.blocks} blocks carry more than one department`}
            />
          </div>
        </section>
      </main>

      <footer className="border-t border-rule bg-surface">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-baseline justify-between gap-x-8 gap-y-3 px-6 py-8 font-mono text-[11px] leading-relaxed text-ink-mut">
          <span>
            Corridor · Automatic block planning · Ministry of Railways · Smart
            India Hackathon 2026
          </span>
          {/*  The two pages that describe the system rather than a division's
               plan. Open to anyone, and reachable without an account - which is
               the point of them.  */}
          <span className="flex gap-5">
            <Link href="/method" className="underline underline-offset-2 hover:text-ink">
              How it decides
            </Link>
            <Link href="/limits" className="underline underline-offset-2 hover:text-ink">
              What it does not know
            </Link>
          </span>
        </div>
      </footer>
    </>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-lg border border-rule bg-surface p-4">
      <p className="eyebrow mb-1.5">{label}</p>
      <p className="font-display text-[26px] font-bold leading-none text-ink">
        {value}
      </p>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-mut">{note}</p>
    </div>
  );
}
