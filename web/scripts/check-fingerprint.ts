/**
 * Check the plan fingerprint does what it claims.
 *
 *   npx tsx scripts/check-fingerprint.ts
 *
 * Each check is written so it can FAIL, and says what it would mean if it did.
 * That matters more here than anywhere: a tamper-evidence check that cannot
 * fail is a picture of one, and this project has shipped two assertions that
 * could not fail before (the `|| true`, and a PASS printed beside LEAK).
 *
 * Offline properties run always. The database checks run when .env.local
 * configures one, and report a missing migration as missing rather than as a
 * failure of the fingerprint.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { canonicalPlan, planFingerprint } from "../lib/fingerprint";
import type { PlanPayload } from "../lib/plan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "**FAIL**"}  ${label}${detail ? "  " + detail : ""}`);
}

const ROOT = path.join(__dirname, "..");
const plan: PlanPayload = JSON.parse(
  readFileSync(path.join(ROOT, "public", "data", "plan.json"), "utf-8"),
);
const clone = (): PlanPayload => JSON.parse(JSON.stringify(plan));

void (async () => {
  console.log("\n=== 1. properties of the hash ===");
  const h = await planFingerprint(plan);
  check("is a 64-character lower-case hex SHA-256", /^[0-9a-f]{64}$/.test(h), h.slice(0, 16));
  check("the same plan hashes the same twice", h === (await planFingerprint(plan)));

  //  Sorting is what makes this true. Remove it and the next check fails.
  const shuffled = clone();
  shuffled.optimised.blocks.reverse();
  shuffled.optimised.tasks.reverse();
  for (const b of shuffled.optimised.blocks) b.departments.reverse();
  check(
    "order in which blocks and tasks arrive does not change it",
    (await planFingerprint(shuffled)) === h,
  );

  //  The reason it exists. If this passes with equal hashes, the fingerprint
  //  is not protecting block timing at all.
  const moved = clone();
  moved.optimised.blocks[0].startSlot += 1;
  check("moving one block by one slot changes it", (await planFingerprint(moved)) !== h);

  const reassigned = clone();
  const t = reassigned.optimised.tasks.find((x) => x.scheduled);
  if (t) t.blockId = "BLK-TAMPERED";
  check("reassigning one task to another block changes it", (await planFingerprint(reassigned)) !== h);

  const repriced = clone();
  repriced.optimised.blocks[0].detentionMinutes += 1;
  check("altering a block's printed detention changes it", (await planFingerprint(repriced)) !== h);

  //  And the other direction: things that are NOT the grant must not move it,
  //  or approving a plan would change the fingerprint of the plan approved.
  const cosmetic = clone() as PlanPayload & { status?: string };
  cosmetic.status = "approved";
  cosmetic.optimised.blocks[0].startHHMM = "99:99";
  cosmetic.generatedAt = "1999-01-01T00:00:00Z";
  check(
    "status, derived HH:MM and generation time do NOT change it",
    (await planFingerprint(cosmetic)) === h,
  );

  check(
    "the canonical form carries a version, so a changed form cannot match silently",
    canonicalPlan(plan).startsWith('{"v":'),
  );

  console.log("\n=== 2. the seed and the library agree ===");
  const seedSql = readFileSync(
    path.join(ROOT, "..", "supabase", "migrations", "0004_seed_plan.sql"),
    "utf-8",
  );
  //  The hash follows the payload. It used to be the last value in the insert,
  //  and this pattern required the `);` after it - so when 0012 put the
  //  engine's check record after it, the seed still carried the right hash
  //  and this said it carried none. Anchor on what precedes it, not what ends
  //  the statement.
  const inSeed = seedSql.match(/::jsonb, '([0-9a-f]{64})'[,)]/)?.[1] ?? null;
  check(
    "0004_seed_plan.sql carries this plan's fingerprint",
    inSeed === h,
    inSeed === null ? "no fingerprint in the seed - rerun build-seed.ts" : inSeed.slice(0, 16),
  );

  console.log("\n=== 3. the database agrees (needs 0011 and a re-run 0004) ===");
  let env = "";
  try {
    env = readFileSync(path.join(ROOT, ".env.local"), "utf-8");
  } catch {
    /* no database configured - offline properties only */
  }
  const base = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim();
  const key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim();
  if (!base || !key) {
    console.log("  (skipped: no database configured)");
  } else {
    const r = await fetch(`${base}/rest/v1/rpc/my_plan`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_officer_id: "SrDEN/ECoR/WAT", p_password: "block@2026" }),
    });
    const b = r.ok ? await r.json() : null;
    const stored: string | null | undefined = b?.plan?.plan_hash;
    if (stored === undefined) {
      console.log("  NOTE  plan_hash column not returned - run 0011_plan_fingerprint.sql, then 0004");
    } else if (stored === null) {
      console.log("  NOTE  plan_hash is empty on the row - re-run 0004_seed_plan.sql");
    } else {
      check("the row's stored fingerprint matches this plan", stored === h, stored.slice(0, 16));
      const recomputed = b?.payload ? await planFingerprint(b.payload) : null;
      check(
        "recomputing from the payload the database serves gives the stored value",
        recomputed === stored,
        recomputed === null ? "no payload returned" : "",
      );
    }
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
})();
