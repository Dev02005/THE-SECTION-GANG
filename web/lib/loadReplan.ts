import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReplanSet } from "./replan";

/**
 * Server-only: read the precomputed replans. Null when they have not been
 * built - or when the file is the older single-scenario format, which this
 * page no longer reads: better "not built" than half of a set.
 */
export async function loadReplan(): Promise<ReplanSet | null> {
  try {
    const file = path.join(process.cwd(), "public", "data", "replan.json");
    const data = JSON.parse(await readFile(file, "utf-8")) as ReplanSet;
    return Array.isArray(data.scenarios) && data.scenarios.length > 0 ? data : null;
  } catch {
    return null;
  }
}
