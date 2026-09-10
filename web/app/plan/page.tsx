import { RequireSignIn } from "@/components/RequireSignIn";
import { loadPlan } from "@/lib/loadPlan";
import { PlanGate } from "./PlanDocument";

export const dynamic = "force-static";

export const metadata = {
  title: "Block plan",
  description:
    "The weekly block plan as an issuable document: every proposed block with " +
    "its section, scope, timing and the work it carries, by department.",
};

/**
 * The plan as a document.
 *
 * Railway planning happens on paper. A block plan that can be printed, carried
 * into the divisional meeting and marked up is worth more than a dashboard that
 * cannot leave the screen - and it is the form the output actually takes today.
 *
 * The conventions are deliberate: a block reference, section and scope, the
 * road affected, protection and clearance shown as part of the block rather
 * than hidden, work listed by department with chainage, and a signature block
 * for the three approving officers. It closes by stating what it is: a proposal
 * for the block meeting, not a grant. BDMS remains the system of record.
 *
 * The artefact loaded here is the fallback, not the source. `PlanGate` reads
 * the plan this post is entitled to from the database and falls back to this
 * file only when no database is configured.
 */
export default async function PlanDocumentPage() {
  const plan = await loadPlan();
  return (
    <RequireSignIn>
      <main className="doc mx-auto w-full max-w-[860px] flex-1 px-8 py-10 print:max-w-none print:px-0 print:py-0">
        <PlanGate fallback={plan} />
      </main>
    </RequireSignIn>
  );
}
