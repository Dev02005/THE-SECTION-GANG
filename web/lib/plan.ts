/**
 * The plan artefact contract.
 *
 * These types mirror `engine/export/plan_json.py`. The engine's Pydantic models
 * are the source of truth; if the two ever disagree, the engine is right and
 * this file is stale.
 */

export type Department = "ENGG" | "SNT" | "TRD";
export type Scope = "UP" | "DN" | "SECTION";
export type Road = "UP" | "DN";
export type Criticality = "A" | "B" | "C";

export interface BlockTask {
  id: string;
  department: Department;
  activity: string;
  criticality: Criticality;
  km: number;
}

export interface PlanBlock {
  id: string;
  section: string;
  scope: Scope;
  roads: Road[];
  day: number;
  startSlot: number;
  durSlots: number;
  startHHMM: string;
  endHHMM: string;
  durationMin: number;
  departments: Department[];
  clubbed: boolean;
  detentionMinutes: number;
  tasks: BlockTask[];
}

export interface PlanTask {
  id: string;
  department: Department;
  section: string;
  activity: string;
  criticality: Criticality;
  scheduled: boolean;
  blockId: string | null;
  startSlot: number | null;
  endSlot: number | null;
  startHHMM: string | null;
  riskRate: number;
  scheduleDriven: boolean;
}

export interface Kpis {
  label: string;
  blocks: number;
  block_hours: number;
  detention_minutes: number;
  detention_per_task: number;
  risk_carried: number;
  scheduled: number;
  deferred: number;
  statutory_done: number;
  statutory_total: number;
  multidept_blocks: number;
  multidept_pct: number;
  packing: number;
  statutoryPct: number;
}

export interface Deltas {
  blocks_pct: number | null;
  block_hours_pct: number | null;
  detention_pct: number | null;
  detention_per_task_pct: number | null;
  risk_carried_pct: number | null;
  throughput_pct: number | null;
  packing_ratio: number;
  statutory_before: string;
  statutory_after: string;
}

export interface ShortfallEntry {
  taskId: string;
  criticality: Criticality;
  riskRate: number;
  bindingConstraint: string;
}

export interface PlanPayload {
  schemaVersion: number;
  generatedAt: string;
  provenance: {
    synthetic: boolean;
    notice: string;
    seed: number | null;
    pricedBy: string[];
    modelVersions: Record<string, string>;
    modelMetrics: Record<string, Record<string, number>>;
  };
  horizon: {
    slots: number;
    days: number;
    slotMinutes: number;
    slotsPerDay: number;
  };
  sections: { id: string; name: string; kmFrom: number; kmTo: number }[];
  roads: Road[];
  /**
   * The real premium paths the plan is drawn around, measured from the
   * published timetable. Optional because an artefact built before these
   * existed will not carry them.
   */
  protectedPaths?: {
    train: string;
    name: string;
    from: string;
    to: string;
    wrapsMidnight: boolean;
    daysPerWeek: number;
  }[];
  resources: Record<string, number>;
  detentionSurface: Record<string, number[]>;
  weights: {
    alpha_risk: number;
    alpha_detention: number;
    alpha_fixed: number;
    alpha_club: number;
  };
  solver: {
    status: string;
    objective: number;
    bound: number | null;
    gapPct: number | null;
    wallTimeS: number;
    deterministic: boolean;
    statutoryProven: boolean;
  };
  placement: {
    status: string;
    objective: number;
    bound: number;
    gapPct: number | null;
    wallTimeS: number;
    tasksPinned: number;
    restriction: string;
  } | null;
  optimised: { blocks: PlanBlock[]; tasks: PlanTask[] };
  baseline: { blocks: PlanBlock[]; tasks: PlanTask[] };
  kpis: { optimised: Kpis; baseline: Kpis; deltas: Deltas };
  pareto: {
    note: string;
    points: {
      alpha_risk: number;
      alpha_detention: number;
      detention_minutes: number;
      risk_carried: number;
      blocks: number;
      scheduled: number;
      statutory_done: number;
      statutory_total: number;
      multidept_pct: number;
      objective: number;
      bound: number | null;
      gap_pct: number | null;
      wall_time_s: number;
      is_current_policy: boolean;
      dominated_by: number | null;
    }[];
  } | null;
  explanations: Record<
    string,
    {
      headline: string;
      clubbing: {
        actual_blocks: number;
        separate_blocks: number;
        actual_detention: number;
        separate_detention: number;
        detention_saved: number;
        overheads_saved: number;
        departments: number;
      } | null;
      placement: {
        detention_here: number;
        cheapest_alternative: number | null;
        cheapest_slot_hhmm: string | null;
        penalty_vs_cheapest: number;
      };
    }
  >;
  shortfall: ShortfallEntry[];
  baselineShortfall: ShortfallEntry[];
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const DEPT_LABEL: Record<Department, string> = {
  ENGG: "Engineering",
  SNT: "S&T",
  TRD: "Traction",
};

/** Department colour, or the clubbed colour when a block carries more than one. */
export function blockColour(block: PlanBlock): string {
  if (block.clubbed) return "var(--clubbed)";
  return `var(--${block.departments[0].toLowerCase()})`;
}

export function rowKey(section: string, road: Road): string {
  return `${section}|${road}`;
}
export function formatSigned(value: number | null, suffix = "%"): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
}

/**
 * The identifier a plan is known by, on the printed document and in the row.
 *
 * ONE function, because this string is written in two places that must agree:
 * `scripts/build-seed.ts` puts it in the `plans` row, and the browser compares
 * against it to tell whether a row describes the artefact it is holding. Two
 * copies of a format string is the drift bug this project has already been
 * bitten by three times - the activity table, the asset table, the corridor
 * chainages - so it gets written once and imported.
 *
 * `SIH26027` is the problem statement, not the product: it identifies the
 * submission on an artefact a judge is holding, which is exactly what a plan
 * reference is for.
 */
export function planReference(plan: {
  provenance: { seed?: number | null };
  generatedAt?: string;
}): string {
  return `SIH26027/${plan.provenance.seed ?? 0}/${(plan.generatedAt ?? "").slice(0, 10)}`;
}
