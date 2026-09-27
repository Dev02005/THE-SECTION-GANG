import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The measured scale ladder, as `engine/benchmark.py` wrote it.
 *
 * Moved out of the /scale page so /limits can read the reference rung too.
 * /limits used to state "4 sections, 90 tasks and 576 candidate windows" as
 * typed literals - and the 90 was written as a ternary whose two branches were
 * both "90", which looked derived and was not. A figure dressed up as computed
 * is worse than a plain literal: it defeats the one check this project runs on
 * itself. One loader, read by both pages.
 */
export interface BenchmarkRow {
  tasks: number;
  sections: number;
  horizon_days: number;
  start_step_min: number;
  windows: number;
  assignment_vars: number;
  build_time_s: number;
  solve_time_s: number;
  status: string;
  objective: number;
  bound: number | null;
  gap_pct: number | null;
  blocks: number;
  scheduled: number;
  statutory_done: number;
  statutory_total: number;
  multidept_pct: number;
}

export interface Benchmark {
  generatedAt: string;
  secondsPerRung: number;
  note: string;
  rows: BenchmarkRow[];
}

export async function loadBenchmark(): Promise<Benchmark | null> {
  try {
    const file = path.join(process.cwd(), "public", "data", "benchmark.json");
    return JSON.parse(await readFile(file, "utf-8")) as Benchmark;
  } catch {
    return null;
  }
}
