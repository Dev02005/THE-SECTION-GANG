import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PlanPayload } from "./plan";

/**
 * Reads the precomputed plan artefact at build time.
 *
 * This is the demo's load path, and deliberately so: the deployed site renders
 * a complete, correct comparison with no backend running at all. A cold-started
 * API or a dropped network cannot break the demonstration. The live "Re-plan"
 * button is an enhancement on top, never a dependency.
 */
export async function loadPlan(): Promise<PlanPayload> {
  const file = path.join(process.cwd(), "public", "data", "plan.json");
  return JSON.parse(await readFile(file, "utf-8")) as PlanPayload;
}
