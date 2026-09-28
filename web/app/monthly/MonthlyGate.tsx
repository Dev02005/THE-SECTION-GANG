"use client";

import { MonthlyView } from "@/components/MonthlyView";
import { ScopedPlan } from "@/components/ScopedPlan";
import type { MonthlyPayload } from "@/lib/monthly";
import type { PlanPayload } from "@/lib/plan";

/**
 * The client boundary, as for every page behind `ScopedPlan`.
 *
 * Scoped first, matched second: `ScopedPlan` decides which plan this post may
 * see at all (Ambala sees none, and so sees no month); `MonthlyView` then shows
 * the month only if it was built from that plan's backlog.
 */
export function MonthlyGate({
  fallback,
  monthly,
}: {
  fallback: PlanPayload;
  monthly: MonthlyPayload | null;
}) {
  return (
    <ScopedPlan fallback={fallback}>
      {(plan) => <MonthlyView plan={plan} m={monthly} />}
    </ScopedPlan>
  );
}
