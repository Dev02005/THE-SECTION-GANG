import { ProvenanceBanner } from "@/components/ProvenanceBanner";
import { RequireSignIn } from "@/components/RequireSignIn";
import { SiteHeader } from "@/components/SiteHeader";
import { loadMonthly } from "@/lib/loadMonthly";
import { loadPlan } from "@/lib/loadPlan";
import { MonthlyGate } from "./MonthlyGate";

export const dynamic = "force-static";

export const metadata = {
  title: "Monthly plan",
  description:
    "The month ahead: which week each maintenance job goes in, how much corridor " +
    "each section needs, and how much of week 1 the weekly solver actually fits.",
};

export default async function MonthlyPage() {
  const [plan, monthly] = await Promise.all([loadPlan(), loadMonthly()]);
  return (
    <>
      <SiteHeader />
      <ProvenanceBanner provenance={plan.provenance} />
      <RequireSignIn>
        <main className="justified mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">
          <MonthlyGate fallback={plan} monthly={monthly} />
        </main>
      </RequireSignIn>
    </>
  );
}
