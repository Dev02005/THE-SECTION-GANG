import type { PlanBlock, PlanPayload } from "./plan";

/**
 * The precomputed replan, as `engine/build_replan.py` wrote it.
 *
 * Kept in its own file beside plan.json rather than inside it, so the approved
 * plan, its fingerprint and the seeded database are all left untouched by the
 * scenario.
 *
 * Types and the match rule only - no filesystem - so the browser can import it.
 * The loader lives in loadReplan.ts, as the plan's does in loadPlan.ts.
 */
export interface ReplanPayload {
  schemaVersion: number;
  generatedAt: string;
  /** Identifies the approved plan this replan is OF. */
  approved: { objective: number; seed: number; blocks: number };
  disruption: {
    atSlot: number;
    atLabel: string;
    section: string;
    line: string;
    activity: string;
    dueSlot: number;
    dueLabel: string;
    bookedSlots: number;
    resources: Record<string, number>;
    description: string;
    hoursToDue: number;
    /** Days between disruption and deadline on which a block is permitted. */
    workableDays: string[];
  };
  urgent: {
    tid: string;
    scheduled: boolean;
    window: string | null;
    start: number | null;
    end: number | null;
    startLabel: string | null;
    endLabel: string | null;
  };
  result: {
    status: string;
    statutoryKept: number | null;
    statutoryProven: boolean;
    minChanges: number | null;
    minChangesProven: boolean;
    frozenBlocks: number;
    wallTimeS: number;
  };
  diff: {
    executed: string[];
    kept: string[];
    changed: string[];
    dropped: string[];
    added: string[];
    tasksMoved: { task: string; from: string; to: string }[];
    tasksDeferred: string[];
    tasksPickedUp: string[];
    detentionAhead: { approved: number; replanned: number };
    statutory: { approved: [number, number]; replanned: [number, number] };
  };
  lost: {
    tid: string;
    activity: string;
    section: string;
    dueSlot: number;
    dueLabel: string;
    windowsBeforeDue: number;
    windowDays: string[];
    blackoutDaysBeforeDue: string[];
  }[];
  counterfactuals: {
    resource: string;
    from: number;
    to: number;
    statutoryKept: number | null;
    minChanges: number | null;
    lost: string[];
    avoidsTheLoss: boolean;
  }[];
  blackoutDays: string[];
  replannedBlocks: PlanBlock[];
}

/**
 * Whether this replan is a replan OF this plan.
 *
 * The replan is precomputed against one specific approved week. Showing it
 * beside any other plan - a re-solve, another division's, a stale file after
 * a rebuild - would present a disruption response to a plan it was never
 * computed for. The objective and seed identify the exact solve; both have to
 * match, or the page says the scenario belongs to a different plan.
 */
export function replanMatches(r: ReplanPayload, plan: PlanPayload): boolean {
  return (
    r.approved.objective === plan.solver.objective &&
    r.approved.seed === plan.provenance.seed
  );
}
