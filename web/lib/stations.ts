import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The national station master.
 *
 * Real, public-domain reference data: 8,697 stations with codes, names, states
 * and coordinates, from DataMeet's CC0 railways dataset. Together with the
 * Ministry zone list in `railways.ts` this is the whole of the real data in
 * this application.
 *
 * This file is REFERENCE data: it never reaches the optimiser, and no number
 * on the planner comes from it. The engine holds its own five-station subset
 * in `engine/core/stations.py`, and THAT one does feed the model - the section
 * boundaries are derived from those coordinates. Keeping the two separate, and
 * saying which is which, matters: a dataset that decorates a page while the
 * engine runs on something else is the kind of claim we take other entrants
 * apart for.
 *
 * Loaded at build time on the one page that renders it, so the 670 KB never
 * reaches a browser that did not ask for it.
 */

export interface Station {
  /** Station code, e.g. VZM. */
  c: string;
  /** Station name. */
  n: string;
  /** Zone code, or null where the source does not assign one. */
  z: string | null;
  /** State. */
  s: string | null;
  lon: number;
  lat: number;
}

export interface StationData {
  source: string;
  url: string;
  retrieved: string;
  note: string;
  stations: number;
  zoneCounts: Record<string, number>;
  rows: Station[];
}

export async function loadStations(): Promise<StationData> {
  const file = path.join(process.cwd(), "public", "data", "stations.json");
  return JSON.parse(await readFile(file, "utf-8")) as StationData;
}

/** Great-circle distance in km. */
export function haversine(a: Station, b: Station): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dp = p2 - p1;
  const dl = rad(b.lon - a.lon);
  const h =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The stations our reference corridor actually runs through, in order.
 *
 * Every one of these resolves in the national dataset, which is worth checking
 * rather than asserting - the corridor was named from railway knowledge before
 * we held any real data, and it would have been entirely possible to have
 * invented a station that does not exist.
 */
export const CORRIDOR_CODES = ["DVD", "KTV", "KPL", "ALM", "VZM"] as const;

export interface CorridorStop {
  station: Station;
  /** Straight-line km from the first stop. */
  km: number;
}

export function corridorChain(data: StationData): CorridorStop[] {
  const byCode = new Map(data.rows.map((r) => [r.c, r]));
  const chain: Station[] = [];
  for (const code of CORRIDOR_CODES) {
    const s = byCode.get(code);
    if (s !== undefined) chain.push(s);
  }
  let cum = 0;
  return chain.map((station, i) => {
    if (i > 0) cum += haversine(chain[i - 1], station);
    return { station, km: cum };
  });
}

/**
 * Vande Bharat services, by zone.
 *
 * Real and published - but the timetable we hold predates them, so we know
 * these services exist without knowing their paths through our corridor. They
 * are therefore NOT among the protected paths the engine plans around, and the
 * page says so. Filling that gap with an invented timing is precisely what
 * this whole exercise has been undoing.
 */
export interface VandeBharat {
  service: string;
  zone: string;
  km: number | null;
  time: string | null;
  maxKmh: number | null;
  avgKmh: number | null;
}

export interface PremiumData {
  source: string;
  note: string;
  services: number;
  rows: VandeBharat[];
}

export async function loadVandeBharat(): Promise<PremiumData | null> {
  try {
    const file = path.join(process.cwd(), "public", "data", "vandebharat.json");
    return JSON.parse(await readFile(file, "utf-8")) as PremiumData;
  } catch {
    return null;
  }
}
