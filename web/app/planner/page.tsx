import { ProvenanceBanner } from "@/components/ProvenanceBanner";
import { RequireSignIn } from "@/components/RequireSignIn";
import { SiteHeader } from "@/components/SiteHeader";
import { loadPlan } from "@/lib/loadPlan";
import { PlannerGate } from "./PlannerGate";

export const dynamic = "force-static";

export const metadata = {
  title: "Planner",
  description:
    "Current practice against the optimised joint block plan, on the same axes, " +
    "with the detention cost surface behind both.",
};

export default async function PlannerPage() {
  const plan = await loadPlan();
  return (
    <>
      <SiteHeader />
      <ProvenanceBanner provenance={plan.provenance} />
      <RequireSignIn>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow mb-1.5">
              Weekly horizon · {plan.horizon.days} days
            </p>
            <h1 className="text-[26px] font-bold">
              The same backlog, planned two ways
            </h1>
          </div>
          <a
            href="/plan"
            className="rounded-md border border-rule px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-sunk"
          >
            Issue as a block plan →
          </a>
        </div>
        <PlannerGate fallback={plan} />
      </main>
      </RequireSignIn>
    </>
  );
}
