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
            formulation itself is code, in{" "}
            <code className="font-mono text-[14px]">engine/solver/</code>; this
            is what it means.
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
          <p>
            Eleven of them, each with a test that fails without it. They are
            named the way a division says them; the model&rsquo;s own
            identifier is kept in brackets. These are descriptions of what the
            constraints do, <strong>not citations of the General and Subsidiary
            Rules</strong> — we have not checked them against that book, so we
            do not label them as if we had.
          </p>
          <ul className="my-2 flex flex-col gap-2.5">
            {(plan.constraints ?? []).map((c) => (
              <li key={c.id} className="border-l-2 border-rule pl-3">
                <strong className="text-ink">{c.name}</strong>{" "}
                <span className="font-mono text-[11px] text-ink-mut">{c.id}</span>
                <br />
                <span className="text-[13.5px] text-ink-mid">{c.detail}</span>
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

        <DocSection n="06" title="Why each block is where it is">
          <p>
            Click any block on the planner and it answers two questions, by
            exact accounting over the solved plan rather than by a second
            model. <strong>What did sharing save?</strong> The same jobs, each
            priced in the cheapest window it could have used on its own,
            against what they cost together. The alternative is given its best
            case, so a reported saving is a floor.{" "}
            <strong>What did this slot cost?</strong> The block against the
            cheapest window of the same length on its section.
          </p>
          <p>
            The second answer is often not flattering, and it is shown anyway:
            most shared blocks sit in a dearer slot than the cheapest one
            available. The cheapest slot takes no account of due dates or of
            the one tower wagon, and the optimiser chose to pay the
            difference, so the reason is one of those.
          </p>
        </DocSection>

        <DocSection n="07" title="A month, then a week">
          <p>
            A month is planned a level up: which week each job goes in, and how
            much corridor each section needs that week. It cannot see roads or
            minutes, so it is held to the packing the weekly solver actually
            achieves on a full week, and every rule it keeps is a coarse form of
            a weekly one.
          </p>
          <p>
            Then it is checked. Week 1&rsquo;s allocation goes to the weekly
            solver unchanged; what does not fit to the minute rolls forward, and
            the rest of the month is re-planned with it. The fit rate is shown,
            not tuned away.
          </p>
        </DocSection>

        <DocSection n="08" title="When the week does not go to plan">
          <p>
            A defect found mid-week is not priced like the backlog. It is{" "}
            <strong>required</strong>: either it is dealt with by its deadline
            or the replan says it cannot be, in so many words. Blocks already
            worked are frozen exactly as they ran.
          </p>
          <p>
            Then three questions, answered strictly in order, each one holding
            the answer to the one before: keep as many statutory jobs as can be
            kept; change as few approved jobs as possible; be as cheap as
            possible. Each is a separate solve, so the first two answers can be{" "}
            <strong>proven</strong> rather than traded against cost with a
            weight somebody chose, and on the scenario shipped here both are.
            A weighted version was tried first and kept none of the approved
            blocks: its search never got near the approved week. Every stage
            now starts from the approved plan.
          </p>
          <p>
            Finally it re-solves with one more of each resource the defect
            needs, and reports which of them would have avoided the loss. That
            is the sentence a DRM can act on.
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
