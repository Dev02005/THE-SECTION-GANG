"use client";

import { Dashboard } from "@/components/Dashboard";
import { ScopedPlan } from "@/components/ScopedPlan";
import type { PlanPayload } from "@/lib/plan";
import type { CorridorStop } from "@/lib/stations";

/**
 * The client boundary between the static page and the scoped plan.
 *
 * `ScopedPlan` takes a render prop, and a function cannot cross from a server
 * component into a client one - React refuses it outright ("Functions are not
 * valid as a child of Client Components"). So every page that uses
 * `ScopedPlan` needs a thin client wrapper: `PlannerGate` for the planner,
 * `PlanGate` for the document, and this one.
 *
 * The page above stays statically rendered and keeps carrying the artefact as
 * its fallback; everything scoped happens below this line, in the browser,
 * under the signed-in officer's own credential.
 */
export function DashboardGate({
  fallback,
  chain,
}: {
  fallback: PlanPayload;
  chain: CorridorStop[];
}) {
  return (
    <ScopedPlan fallback={fallback}>
      {(plan) => <Dashboard plan={plan} chain={chain} />}
    </ScopedPlan>
  );
}
