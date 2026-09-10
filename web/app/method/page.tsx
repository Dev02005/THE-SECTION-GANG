import { ProvenanceBanner } from "@/components/ProvenanceBanner";
import { DocSection } from "@/components/DocSection";
import { SiteHeader } from "@/components/SiteHeader";
import { loadPlan } from "@/lib/loadPlan";

export const dynamic = "force-static";

export const metadata = {
  title: "Method",
  description:
    "How the planner decides: pricing asset risk and train detention in one " +
    "unit, then buying the most risk reduction per minute of line occupation " +
    "across three departments.",
};

export default async function MethodPage() {
  const plan = await loadPlan();

  return (
    <>
      <SiteHeader />
      <ProvenanceBanner provenance={plan.provenance} />

      <main className="mx-auto w-full max-w-[820px] flex-1 px-6 pb-14">
        <section className="pb-1 pt-12">
          <p className="eyebrow mb-3">Method</p>
          <h1 className="text-[clamp(2rem,4.5vw,2.9rem)] font-bold leading-[1.05]">
            How it decides
          </h1>
          <p className="mt-5 text-[16.5px] leading-relaxed text-ink-mid">
            Written for a railway officer rather than a mathematician. The
            formulation is in the repository; this is what it means.
          </p>
        </section>

        <DocSection n="01" title="Both sides of the trade-off, in one unit">
          <p>
            A block spends line capacity and buys risk reduction. To compare
            them you need one currency, and ours is{" "}
            <strong>detention-minute equivalents</strong>.
          </p>
          <p>
            A defect&rsquo;s price is the train detention it will cause if left
            alone: its daily failure hazard multiplied by the consequence of
            that failure, spread across the horizon.
          </p>
          <Formula>ρ = ⌈ C × λ ÷ slots-per-day ⌉</Formula>
          <p>
            λ comes from the survival model. <strong>C does not.</strong> The
            consequence table is a published policy input agreed with the
            division from incident records — it is where railway judgment enters
            the system, and burying it in model weights would make the
            system&rsquo;s priorities unauditable.
          </p>
          <p>
            The effect is that a degraded overdue rail prices at roughly{" "}
            <strong>109×</strong> a fresh signal lamp. That ratio is derived, not
            hand-set, and it is directly comparable to detention. We do not{" "}
            <em>rank</em> tasks. We <em>price</em> them.
          </p>
        </DocSection>

        <DocSection n="02" title="What the optimiser decides">
          <p>
            One constraint-programming model decides, jointly for all three
            departments: which candidate windows to grant, how long each block
            runs, which tasks go inside it and where, and what to defer.
          </p>
          <Formula>
            minimise&nbsp;&nbsp;α<sub>R</sub>·Σ ρ<sub>t</sub>·τ<sub>t</sub>
            &nbsp;+&nbsp; α<sub>R</sub>·Σ ρ<sub>t</sub>·(T+Δ)(1−z<sub>t</sub>)
            &nbsp;+&nbsp; α<sub>D</sub>·Σ tbl<sub>w</sub>[δ<sub>w</sub>]
            &nbsp;+&nbsp; α<sub>F</sub>·K·Σ G<sub>w</sub>
            &nbsp;−&nbsp; α<sub>C</sub>·B·Σ e<sub>w</sub>
          </Formula>
          <p>
            The last term is the entire point of the system.{" "}
            <strong>
              e<sub>w</sub> counts the <em>extra</em> departments sharing block
              w
            </strong>{" "}
            — and it is the only quantity in the objective that no single
            department can see or express when it bids for its own block through
            BDMS.
          </p>
          <p>
            The fourth term is why four one-hour blocks are worse than one
            four-hour block even at equal detention: protection, caution order
            and the first train back over the site cost the same whatever the
            block&rsquo;s length.
          </p>
        </DocSection>

        <DocSection n="03" title="The constraints that carry the domain">
          <ul className="my-2 flex flex-col gap-2.5">
            {[
              ["Line occupation", "No two blocks hold the same road at once. A section-scope window is inserted into both roads' sets — one line of the model encoding the power-block coupling: OHE work takes the section down and pays detention twice."],
              ["Resources", "One tower wagon, one tamper, two USFD units, gangs and crews, shared division-wide. The single tower wagon is the classic binding constraint and the model finds it without being told."],
              ["Containment", "Work starts after protection is complete and ends before clearance begins. A block does not start when the gang starts."],
              ["Statutory", "Criticality-A work is a hard constraint, solved first. When a plan comes back feasible we have a proof every obligation is met — not a claim the penalty was large enough."],
              ["Protected paths", "Measured from the timetable, not assumed. Windows overlapping a real premium path are never generated, and a window is shortened rather than discarded so a block can still run and clear before the train."],
            ].map(([h, p]) => (
              <li key={h} className="border-l-2 border-rule pl-3">
                <strong className="text-ink">{h}</strong>
                <br />
                <span className="text-[13.5px] text-ink-mid">{p}</span>
              </li>
            ))}
          </ul>
        </DocSection>

        <DocSection n="04" title="When the backlog exceeds the corridor">
          <p>
            The statutory constraint runs hard first. If the backlog genuinely
            exceeds what the corridor can hold, the model is infeasible — and
            the system re-solves with the obligation softened, returning a plan{" "}
            <strong>plus an explicit shortfall list</strong>: which item, its
            priced risk, and which constraint bound.
          </p>
          <p>
            An optimiser that answers &ldquo;INFEASIBLE&rdquo; is useless in an
            operating railway. That list is the artefact a DRM needs to argue
            for more block time with evidence rather than assertion.
          </p>
        </DocSection>

        <DocSection n="05" title="Why constraint programming">
          <p>
            Interval variables, no-overlap and cumulative resources are native,
            so disjunctive scheduling is handled by a dedicated propagator
            rather than by penalty terms in a fitness function.
          </p>
          <p>
            More importantly it returns a <strong>proven bound</strong>. We can
            say that no plan of this work costs less than a stated figure. A
            genetic algorithm gives neither the propagators nor the bound, and
            on a problem this structured it is strictly worse.
          </p>
        </DocSection>

        <p className="mt-12 border-t border-rule pt-6 text-[14px] leading-relaxed text-ink-mut">
          What this method does <em>not</em> establish is set out on the{" "}
          <a href="/limits" className="text-accent underline underline-offset-2">
            limits
          </a>{" "}
          page — data provenance, model validity bounds, the optimality gap, and
          what is designed but not built.
        </p>
      </main>
    </>
  );
}


function Formula({ children }: { children: React.ReactNode }) {
  return (
    <p className="my-1 overflow-x-auto rounded border border-rule bg-surface-sunk px-4 py-3 font-mono text-[13px] text-ink">
      {children}
    </p>
  );
}
