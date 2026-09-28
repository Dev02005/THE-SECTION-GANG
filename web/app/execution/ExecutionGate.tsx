"use client";

import { BlockRecord } from "@/components/BlockRecord";
import { ScopedPlan } from "@/components/ScopedPlan";
import type { PlanPayload } from "@/lib/plan";

/**
 * The client boundary, as for every page behind `ScopedPlan`. The record needs
 * the plan ROW - its id and status - not just the artefact, so it takes the
 * render prop's second argument.
 */
export function ExecutionGate({ fallback }: { fallback: PlanPayload }) {
  return (
    <ScopedPlan fallback={fallback}>
      {(plan, ctx) => <BlockRecord plan={plan} ctx={ctx} />}
    </ScopedPlan>
  );
}
