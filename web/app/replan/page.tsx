import { ProvenanceBanner } from "@/components/ProvenanceBanner";
import { RequireSignIn } from "@/components/RequireSignIn";
import { SiteHeader } from "@/components/SiteHeader";
import { loadPlan } from "@/lib/loadPlan";
import { loadReplan } from "@/lib/loadReplan";
import { ReplanGate } from "./ReplanGate";

export const dynamic = "force-static";

export const metadata = {
  title: "Replan",
  description:
    "A disruption mid-week and what the plan does about it: the past frozen, " +
    "statutory work kept first, the fewest approved jobs changed, and the " +
    "resource that would have avoided the cost.",
};

export default async function ReplanPage() {
  const [plan, replan] = await Promise.all([loadPlan(), loadReplan()]);
  return (
    <>
      <SiteHeader />
      <ProvenanceBanner provenance={plan.provenance} />
      <RequireSignIn>
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">
          <ReplanGate fallback={plan} replan={replan} />
        </main>
      </RequireSignIn>
    </>
  );
}
