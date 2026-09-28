import type { PlanBlock, PlanPayload } from "./plan";

/**
 * The precomputed replans, as `engine/build_replan.py` wrote them: eight
 * disruptions against the approved week, each solved by the same replanner.
 *
 * Kept in its own file beside plan.json rather than inside it, so the approved
 * plan, its fingerprint and the seeded database are all left untouched.
 *
 * Types and the match rule only - no filesystem - so the browser can import it.
 * The loader lives in loadReplan.ts, as the plan's does in loadPlan.ts.
 */
export interface ReplanScenario {
  id: string;
  /** "USFD rail flaw · SEC-02 · Wed 06:00" */
  title: string;
  /** Whether the job could be dealt with by its deadline at all. */
  feasible: boolean;
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
  /** Null when the job cannot be dealt with in time: there is no replan to diff. */
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
  } | null;
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
    feasible: boolean;
    statutoryKept: number | null;
    minChanges: number | null;
    lost: string[];
    /** Met deadline: it loses less. Missed deadline: it makes the job possible. */
    avoidsTheLoss: boolean;
  }[];
  replannedBlocks: PlanBlock[];
}

export interface ReplanSet {
  schemaVersion: number;
  generatedAt: string;
  /** Identifies the approved plan these replans are OF. */
  approved: { objective: number; seed: number; blocks: number };
  blackoutDays: string[];
  featured: string;
  scenarios: ReplanScenario[];
}

/**
 * Whether these replans are replans OF this plan.
 *
 * Each is precomputed against one specific approved week. Showing them beside
 * any other plan - a re-solve, another division's, a stale file after a
 * rebuild - would present disruption responses to a plan they were never
 * computed for. The objective and seed identify the exact solve.
 */
export function replanMatches(r: ReplanSet, plan: PlanPayload): boolean {
  return (
    r.approved.objective === plan.solver.objective &&
    r.approved.seed === plan.provenance.seed
  );
}
