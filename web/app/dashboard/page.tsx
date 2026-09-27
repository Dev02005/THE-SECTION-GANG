import { ProvenanceBanner } from "@/components/ProvenanceBanner";
import { RequireSignIn } from "@/components/RequireSignIn";
import { SiteHeader } from "@/components/SiteHeader";
import { DashboardGate } from "./DashboardGate";
import { loadPlan } from "@/lib/loadPlan";

export const dynamic = "force-static";

export const metadata = {
  title: "Dashboard",
  description:
    "The week at a glance: what the optimised block plan changed against " +
    "current practice, what the solver proved, and what is still not done.",
};

/**
 * The fifteen-second view of the plan this post is entitled to.
 *
 * Behind `ScopedPlan` like the planner and the printed document, for the same
 * reason: a dashboard is exactly the page where showing an officer of another
 * division a headline number that is not theirs would be least noticeable and
 * most wrong. Ambala gets "no plan held", naming Ambala.
 */
export default async function DashboardPage() {
  const plan = await loadPlan();
  return (
    <>
      <SiteHeader />
      <ProvenanceBanner provenance={plan.provenance} />
      <RequireSignIn>
        <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 sm:px-6">
          <DashboardGate fallback={plan} />
        </main>
      </RequireSignIn>
    </>
  );
}
