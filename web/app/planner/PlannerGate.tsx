"use client";

import type { PlanPayload } from "@/lib/plan";
import { ScopedPlan } from "@/components/ScopedPlan";
import { PlannerView } from "./PlannerView";

/**
 * The client boundary between the statically rendered page and the scoped read.
 *
 * It exists only because a render prop is a function, and a function cannot
 * cross from a server component into a client one. `ScopedPlan` decides what
 * this post may see; `PlannerView` draws it, unchanged and unaware.
 */
export function PlannerGate({ fallback }: { fallback: PlanPayload }) {
  return (
    <ScopedPlan fallback={fallback}>
      {(plan) => <PlannerView plan={plan} />}
    </ScopedPlan>
  );
}
