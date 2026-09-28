import { ProvenanceBanner } from "@/components/ProvenanceBanner";
import { RequireSignIn } from "@/components/RequireSignIn";
import { SiteHeader } from "@/components/SiteHeader";
import { loadPlan } from "@/lib/loadPlan";
import { ExecutionGate } from "./ExecutionGate";

export const dynamic = "force-static";

export const metadata = {
  title: "Execution",
  description:
    "The approved block programme against what happened on the ground: when " +
    "each block was granted, when the line went back to traffic, and which " +
    "were not availed.",
};

/**
 * Blocks as worked. Static like every other route: the page ships the plan
 * artefact as its fallback, and the record arrives in the browser under the
 * signed-in officer's own credential, scoped by Postgres.
 */
export default async function ExecutionPage() {
  const plan = await loadPlan();
  return (
    <>
      <SiteHeader />
      <ProvenanceBanner provenance={plan.provenance} />
      <RequireSignIn>
        <main className="justified mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6">
          <ExecutionGate fallback={plan} />
        </main>
      </RequireSignIn>
    </>
  );
}
