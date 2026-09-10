/**
 * Write the station master as a CSV the Supabase table editor can import.
 *
 *     npx tsx scripts/build-stations-csv.ts
 *
 * WHY A CSV AND NOT THE MIGRATION. `0003b_seed_stations.sql` is 1.8 MB, and
 * the SQL editor refuses it outright - "request entity too large". Almost all
 * of that size is the same 90-byte `insert into stations ... on conflict`
 * preamble repeated 8,697 times; the data underneath is a few hundred KB. A
 * CSV carries the rows without the ceremony and goes in through the table
 * editor's importer instead of the query box.
 *
 * The SQL file stays. It is the migration - the thing a fresh clone runs, in
 * order, with no dashboard involved. This is a way to get the same rows into a
 * database by hand when the dashboard is what you have.
 *
 * Both are generated from `public/data/stations.json`, so they cannot disagree.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ZONES } from "../lib/railways";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(ROOT, "..", "supabase", "stations.csv");

interface StationRow {
  c: string;
  n: string;
  z: string | null;
  s: string | null;
  lat: number;
  lon: number;
}

const { rows } = JSON.parse(
  readFileSync(path.join(ROOT, "public", "data", "stations.json"), "utf-8"),
) as { rows: StationRow[] };

const zoneCodes = new Set(ZONES.map((z) => z.code));

/** RFC 4180: quote if it contains a comma, a quote or a newline; double the quotes. */
function f(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const lines = ["code,name,zone_code,state,lat,lon"];
let unlinked = 0;
for (const s of rows) {
  //  zone_code is a foreign key. Konkan (KR) is a PSU rather than one of the
  //  Ministry's 17, so its stations carry no zone rather than a broken one.
  const zone = s.z && zoneCodes.has(s.z) ? s.z : null;
  if (zone === null) unlinked++;
  lines.push([f(s.c), f(s.n), f(zone), f(s.s), f(s.lat), f(s.lon)].join(","));
}

const csv = lines.join("\n") + "\n";
writeFileSync(OUT, csv, "utf-8");
console.log(`supabase/stations.csv  (${(Buffer.byteLength(csv) / 1024).toFixed(0)} KB)`);
console.log(`  ${rows.length} stations · ${unlinked} with no Ministry zone (stored null)`);
