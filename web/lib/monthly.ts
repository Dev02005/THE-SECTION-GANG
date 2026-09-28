import type { Department, PlanPayload } from "./plan";

/**
 * The monthly plan, as `engine/build_monthly.py` wrote it.
 *
 * Its own file beside plan.json, like replan.json: the weekly plan, its
 * fingerprint and the seeded database are untouched by it. Types and the match
 * rule only - no filesystem - so the browser can import it.
 */
export interface MonthlyResourceUse {
  usedHours: number;
  capHours: number;
  pct: number;
}

export interface MonthlyWeek {
  week: number;
  jobs: number;
  byDept: Record<Department, number>;
  statutory: number;
  blockHours: number;
  corridorHours: number;
  bothRoadsHours: number;
  resources: Record<string, MonthlyResourceUse>;
}

export interface MonthlyCell {
  section: string;
  week: number;
  jobs: number;
  depts: Department[];
  statutory: number;
  blockHours: number;
  corridorHours: number;
}

export interface MonthlyPayload {
  schemaVersion: number;
  generatedAt: string;
  seed: number;
  provenance: { synthetic: boolean; notice: string; pricedBy: string[] };
  calibration: { packing: number; note: string };
  horizon: { weeks: number; days: number };
  sections: { id: string; name: string }[];
  solver: {
    status: string;
    objective: number | null;
    bound: number | null;
    gapPct: number | null;
    wallTimeS: number;
  };
  totals: {
    jobs: number;
    placed: number;
    deferred: number;
    statutoryTotal: number;
    statutoryPlaced: number;
    shippedWeekBacklog: number;
    shippedWeekInWeek1: number;
  };
  weeks: MonthlyWeek[];
  cells: MonthlyCell[];
  deferred: {
    id: string;
    dept: Department;
    section: string;
    activity: string;
    criticality: "A" | "B" | "C";
    dueDay: number;
    reason: string;
  }[];
  handoff: {
    week: number;
    allocated: number;
    scheduled: number;
    blocks: number;
    statutory: [number, number];
    packing: number | null;
    status: string;
    wallTimeS: number;
    misses: {
      id: string;
      criticality: "A" | "B" | "C";
      activity: string;
      section: string;
      binding: string;
      rolledToWeek: number | null;
      overdue: boolean;
    }[];
  };
  rolled: {
    status: string;
    carried: number;
    carriedPlaced: number;
    perWeek: number[];
    deferred: number;
  };
}

/**
 * Whether this month belongs beside this plan.
 *
 * The month's first week of backlog is the plan's backlog, so it is shown only
 * with the plan it was built from: the same seed on the same corridor. Any
 * other plan - another division's, a re-solve on another seed - gets a note
 * instead of a month that is not its own.
 */
export function monthlyMatches(m: MonthlyPayload, plan: PlanPayload): boolean {
  const ids = (xs: { id: string }[]) => xs.map((s) => s.id).join("|");
  return m.seed === plan.provenance.seed && ids(m.sections) === ids(plan.sections);
}
