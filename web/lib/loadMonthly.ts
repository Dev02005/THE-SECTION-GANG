import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MonthlyPayload } from "./monthly";

/** Server-only: read the precomputed month. Null when it has not been built. */
export async function loadMonthly(): Promise<MonthlyPayload | null> {
  try {
    const file = path.join(process.cwd(), "public", "data", "monthly.json");
    return JSON.parse(await readFile(file, "utf-8")) as MonthlyPayload;
  } catch {
    return null;
  }
}
