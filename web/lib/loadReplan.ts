import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReplanPayload } from "./replan";

/** Server-only: read the precomputed replan. Null when it has not been built. */
export async function loadReplan(): Promise<ReplanPayload | null> {
  try {
    const file = path.join(process.cwd(), "public", "data", "replan.json");
    return JSON.parse(await readFile(file, "utf-8")) as ReplanPayload;
  } catch {
    return null;
  }
}
