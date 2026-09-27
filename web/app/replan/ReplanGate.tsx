"use client";

import { ReplanView } from "@/components/ReplanView";
import { ScopedPlan } from "@/components/ScopedPlan";
import type { PlanPayload } from "@/lib/plan";
import type { ReplanPayload } from "@/lib/replan";

/**
 * The client boundary, as for every page behind `ScopedPlan` - a render prop
 * cannot cross from a server component into a client one.
 *
 * Scoped first, matched second. `ScopedPlan` decides which plan this post may
 * see at all (Ambala sees none, and so sees no replan); `ReplanView` then shows
 * the scenario only if it was computed against that exact plan.
 */
export function ReplanGate({
  fallback,
  replan,
}: {
  fallback: PlanPayload;
  replan: ReplanPayload | null;
}) {
  return (
    <ScopedPlan fallback={fallback}>
      {(plan) => <ReplanView plan={plan} replan={replan} />}
    </ScopedPlan>
  );
}
