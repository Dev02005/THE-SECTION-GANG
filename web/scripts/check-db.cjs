/**
 * Is the database set up?   node scripts/check-db.cjs
 *
 * Hits the REST API directly rather than going through supabase-js, because
 * the client swallowed a 404: the first version of this script reported "ok"
 * for all twelve tables when none of them existed, and reported "ok" for a
 * table name invented to test it. A check that passes when the thing is
 * missing is worse than no check, so this one reads the HTTP status.
 *
 * It runs ANONYMOUSLY - no session. That is deliberate, and the two states it
 * distinguishes are the ones that matter:
 *
 *   404  the table does not exist. Migrations have not been run.
 *   200  the table exists. An empty result is CORRECT here, not a failure:
 *        every policy requires an authenticated officer, so an anonymous
 *        caller seeing nothing is row-level security working.
 */
const fs = require("node:fs");
const path = require("node:path");

const ENV = path.join(__dirname, "..", ".env.local");
if (!fs.existsSync(ENV)) {
  console.error("no .env.local - copy .env.example and fill in your project URL and key");
  process.exit(1);
}
const env = Object.fromEntries(
  fs
    .readFileSync(ENV, "utf-8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is empty");
  process.exit(1);
}

const TABLES = [
  "zones", "divisions", "officers", "stations", "sections",
  "plans", "tasks", "blocks", "kpis", "protected_paths",
  "audit_log", "profiles",
];

(async () => {
  console.log(`  project ${url}`);
  console.log(`  key     ${key.slice(0, 24)}…\n`);

  let missing = 0;
  let present = 0;

  for (const t of TABLES) {
    //  Prefer: count=exact returns the row count in Content-Range even when
    //  RLS hides every row, which is exactly what we want to see.
    const res = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
    });
    if (res.status === 404) {
      missing += 1;
      console.log(`  ${t.padEnd(16)} MISSING   run the migrations`);
      continue;
    }
    if (!res.ok) {
      console.log(`  ${t.padEnd(16)} HTTP ${res.status}  ${(await res.text()).slice(0, 60)}`);
      continue;
    }
    present += 1;
    const range = res.headers.get("content-range") ?? "";
    const total = range.includes("/") ? range.split("/")[1] : "?";
    console.log(`  ${t.padEnd(16)} exists    ${total} rows`);
  }

  console.log(`\n  ${present}/${TABLES.length} tables present, ${missing} missing`);
  if (missing === TABLES.length) {
    console.log("\n  Nothing has been run yet. In the Supabase SQL editor, run in order:");
    console.log("    0001_schema.sql  0002_rls.sql  0003_seed_org.sql  0004_seed_plan.sql");
  } else if (missing > 0) {
    console.log("\n  Partly applied - a migration probably errored. Re-run the failing one.");
  } else {
    console.log("\n  Schema is in place. Row counts above are what an ANONYMOUS caller");
    console.log("  can see; zero everywhere is row-level security doing its job.");
  }
})();
