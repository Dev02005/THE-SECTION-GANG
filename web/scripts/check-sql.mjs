/**
 * Every migration, run on a real Postgres in this process - no Supabase, no
 * network, no shared state.
 *
 *     node scripts/check-sql.mjs
 *
 * check-auth.cjs tests the LIVE database, which is the one that matters but
 * is also the one visitors are using: a test there must put back everything it
 * changes, and it can only touch rows through the same functions a visitor
 * can. Here the database is our own and thrown away afterwards, so this suite
 * can do what that one cannot - break the stored rows directly and watch the
 * database refuse to move the plan.
 *
 * PGlite is Postgres compiled to WebAssembly, not an imitation of it: the
 * migrations below are the files in supabase/migrations exactly as written.
 * What Supabase adds is stubbed and nothing more - the `auth` schema, the
 * anon/authenticated roles, and the `extensions` schema on the search path.
 * The station master (0003b) is skipped: 1.8 MB that no check here reads.
 *
 * Like check-auth, written to try to BREAK each rule. Every new check is
 * handed a copy of the real plan with its one condition broken, and must fail;
 * a check that could not fail would pass on a plan with no rules at all.
 */
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.resolve(HERE, "..", "..", "supabase", "migrations");
const SKIP = new Set(["0003b_seed_stations.sql"]);
const PW = "block@2026";

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "**FAIL**"}  ${label}${detail ? "  " + detail : ""}`);
}

const db = new PGlite({ extensions: { pgcrypto } });

/** Call a function the way PostgREST does: named arguments, JSON back. */
async function rpc(fn, args) {
  const names = Object.keys(args);
  const call = `${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
  try {
    const r = await db.query(`select to_jsonb(x) as v from ${call} as x`, Object.values(args));
    const rows = r.rows.map((row) => row.v);
    return { ok: true, body: rows.length === 1 ? rows[0] : rows };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
const as = (id, extra = {}) => ({ p_officer_id: id, p_password: PW, ...extra });

console.log("=== 1. every migration runs, in order, on a fresh database ===");
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create role anon;
  create role authenticated;
  create schema extensions;
  set search_path to "$user", public, extensions;
`);
for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
  if (SKIP.has(f)) continue;
  try {
    await db.exec(readFileSync(path.join(MIG, f), "utf-8"));
    check(`${f}`, true);
  } catch (e) {
    check(`${f}`, false, e.message);
    console.log(`\n  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}

const bundle = (await rpc("my_plan", as("SrDEN/ECoR/WAT"))).body;
const PLAN = bundle.plan.id;

// ---------------------------------------------------------------------------
console.log("\n=== 2. the database's own checks, on the stored plan ===");
const stored = (await rpc("check_plan", as("SrDEN/ECoR/WAT", { p_plan_id: PLAN }))).body;
const rules = stored?.rules ?? [];
check("check_plan answers for the plan", Array.isArray(rules) && rules.length > 0,
      `${rules.length} rules re-run in SQL`);
check("**every rule passes on the shipped plan**", rules.every((r) => r.passed),
      rules.filter((r) => !r.passed).map((r) => `${r.id}: ${r.failures[0]}`).join(" | ") ||
        rules.map((r) => `${r.id} ${r.examined}`).join(" · "));
check("the engine's record is present, passing, and of this plan",
      stored?.engine?.present && stored?.engine?.belongs && stored?.engine?.passed,
      `${stored?.engine?.checks} engine checks`);
check("so the plan passes as a whole", stored?.passed === true);
const nr = await rpc("check_plan", as("SrDEN/NR/LKO", { p_plan_id: PLAN }));
check("**another zone gets nothing from check_plan**", nr.ok && nr.body === null,
      JSON.stringify(nr.body).slice(0, 40));

// ---------------------------------------------------------------------------
console.log("\n=== 3. each rule fails when its one condition is broken ===");
//  A copy of the real rows, broken in exactly one way, handed to the same pure
//  function submit and decide call. Any OTHER rule the break trips is printed,
//  not hidden - moving a block can legitimately break two rules at once.
const opt = (xs) => xs.filter((x) => x.variant === "optimised");
async function broken(label, target, mutate) {
  const b = structuredClone(bundle);
  mutate(opt(b.blocks), opt(b.tasks), b);
  const r = await rpc("plan_rule_checks", {
    p_blocks: JSON.stringify(b.blocks),
    p_tasks: JSON.stringify(b.tasks),
    p_paths: JSON.stringify(b.protectedPaths),
    p_shortfall: JSON.stringify(b.payload.shortfall),
    p_horizon_days: b.plan.horizon_days,
  });
  const out = r.body ?? [];
  const hit = out.find((x) => x.id === target);
  const also = out.filter((x) => !x.passed && x.id !== target).map((x) => x.id);
  check(`${target} fails: ${label}`, hit && !hit.passed,
        `${hit?.failures?.[0] ?? r.message ?? "passed"}${also.length ? `  [also ${also.join(",")}]` : ""}`);
}

const blocks = opt(bundle.blocks);
const tasks = opt(bundle.tasks);
const night = blocks.find((b) => b.start_slot % 96 === 4);
const midday = blocks.find((b) => b.start_slot % 96 === 44 && b.dur_slots === 16);
const pair = (() => {
  for (const x of blocks) for (const y of blocks)
    if (x.id < y.id && x.section_id === y.section_id) return [x.id, y.id];
})();
const placed = tasks.find((t) => t.scheduled);
const statutory = tasks.find((t) => t.scheduled && t.criticality === "A");

await broken("a block one slot longer than any corridor allows", "C1", (bs) => {
  bs.find((b) => b.id === midday.id).dur_slots = 17;
});
await broken("two blocks on the same road at once", "C7", (bs) => {
  const [x, y] = pair.map((id) => bs.find((b) => b.id === id));
  Object.assign(y, { start_slot: x.start_slot, dur_slots: x.dur_slots, scope: "SECTION" });
});
await broken("a night block run on to 04:00, across the 03:30 Duronto", "PROT", (bs) => {
  bs.find((b) => b.id === night.id).dur_slots = 12;
});
await broken("every job taken out of a block", "C2", (bs, ts) => {
  const id = blocks[0].id;
  for (const t of ts.filter((x) => x.block_id === id))
    Object.assign(t, { scheduled: false, block_id: null, start_slot: null, end_slot: null });
});
await broken("a job moved onto another section", "FIT", (bs, ts) => {
  const t = ts.find((x) => x.id === placed.id);
  t.section_id = t.section_id === "SEC-01" ? "SEC-02" : "SEC-01";
});
await broken("work starting before protection is in place", "C6", (bs, ts) => {
  const t = ts.find((x) => x.id === placed.id);
  t.start_slot = blocks.find((b) => b.id === placed.block_id).start_slot;
});
//  Added blocks go on the bundle's own list. The first version pushed them
//  onto `bs` - a FILTERED copy - so the database never saw them and both
//  checks "passed"; this suite reported it as the failure it was.
await broken("a third block on one section in one day", "C9", (bs, ts, b) => {
  const x = bs[0];
  b.blocks.push({ ...x, id: `${x.id}-b` }, { ...x, id: `${x.id}-c` });
});
await broken("a fifth night block on one section in the week", "C10", (bs, ts, b) => {
  for (let d = 0; d < 5; d++)
    b.blocks.push({ ...night, id: `EXTRA-${d}`, section_id: "SEC-04", scope: "UP",
                    start_slot: d * 96 + 4, dur_slots: 4, day: d });
});
await broken("a statutory job dropped without a word", "STAT", (bs, ts) => {
  Object.assign(ts.find((x) => x.id === statutory.id),
                { scheduled: false, block_id: null, start_slot: null, end_slot: null });
});

// ---------------------------------------------------------------------------
console.log("\n=== 4. the database refuses to move a plan that fails ===");
//  Now the STORED rows, broken directly - possible here, and only here,
//  because this database is ours. Each break is put back before the next.
async function refusedWhile(label, breakSql, restoreSql, call, expect) {
  await db.exec(breakSql);
  try {
    const r = await rpc(...call);
    check(`**${label}**`, !r.ok && r.message.includes(expect), (r.message ?? JSON.stringify(r.body)).slice(0, 96));
  } finally {
    await db.exec(restoreSql);
  }
}
const [x, y] = pair;
const yRow = blocks.find((b) => b.id === y);
const submit = ["submit_plan", as("SrDEN/ECoR/WAT", { p_plan_id: PLAN })];
await refusedWhile("overlapping blocks: submission refused, naming the rule",
  `update blocks b set start_slot = x.start_slot, dur_slots = x.dur_slots, scope = 'SECTION'
     from blocks x where b.plan_id = '${PLAN}' and b.variant = 'optimised' and b.id = '${y}'
      and x.plan_id = b.plan_id and x.variant = 'optimised' and x.id = '${x}';`,
  `update blocks set start_slot = ${yRow.start_slot}, dur_slots = ${yRow.dur_slots}, scope = '${yRow.scope}'
     where plan_id = '${PLAN}' and variant = 'optimised' and id = '${y}';`,
  submit, "C7");
await refusedWhile("no engine record: submission refused",
  `create temp table _c as select checks from plans where id = '${PLAN}';
   update plans set checks = null where id = '${PLAN}';`,
  `update plans set checks = (select checks from _c) where id = '${PLAN}'; drop table _c;`,
  submit, "no engine check record");
await refusedWhile("an engine record of another build: submission refused",
  `create temp table _c as select checks from plans where id = '${PLAN}';
   update plans set checks = jsonb_set(checks, '{plan,generatedAt}', '"2026-01-01T00:00:00+00:00"') where id = '${PLAN}';`,
  `update plans set checks = (select checks from _c) where id = '${PLAN}'; drop table _c;`,
  submit, "different build");
await refusedWhile("an engine record with a failing check: submission refused",
  `create temp table _c as select checks from plans where id = '${PLAN}';
   update plans set checks = jsonb_set(jsonb_set(checks, '{checks,7,passed}', 'false'), '{passed}', 'false') where id = '${PLAN}';`,
  `update plans set checks = (select checks from _c) where id = '${PLAN}'; drop table _c;`,
  submit, "failed in the engine: C8");

let r = await rpc(...submit);
check("the plan as stored is submitted", r.body?.status === "submitted", `-> ${r.body?.status ?? r.message}`);
const approve = ["decide_plan", as("DRM/ECoR/WAT", { p_plan_id: PLAN, p_approve: true })];
await refusedWhile("rows broken after submission: approval refused at the moment of signing",
  `update tasks set start_slot = ${blocks.find((b) => b.id === placed.block_id).start_slot}
     where plan_id = '${PLAN}' and variant = 'optimised' and id = '${placed.id}';`,
  `update tasks set start_slot = ${placed.start_slot}
     where plan_id = '${PLAN}' and variant = 'optimised' and id = '${placed.id}';`,
  approve, "C6");
//  Sending it back is never gated - that is what a failing plan needs.
await db.exec(`update tasks set section_id = 'SEC-XX' where plan_id = '${PLAN}' and variant = 'optimised' and id = '${placed.id}';`);
r = await rpc("decide_plan", as("DRM/ECoR/WAT", { p_plan_id: PLAN, p_approve: false, p_reason: "FIT fails" }));
check("**a failing plan can still be sent back**", r.body?.status === "rejected", `-> ${r.body?.status ?? r.message}`);
await db.exec(`update tasks set section_id = '${placed.section_id}' where plan_id = '${PLAN}' and variant = 'optimised' and id = '${placed.id}';`);
r = await rpc(...submit);
r = await rpc(...approve);
check("put right, it is approved", r.body?.status === "approved", `-> ${r.body?.status ?? r.message}`);
const log = (await db.query(
  `select detail from audit_log where action = 'plan.approved' order by id desc limit 1`)).rows[0]?.detail;
check("the audit log records what was checked when it was approved",
      !!log?.checks?.database && !!log?.checks?.engine,
      `database ${log?.checks?.database}, engine ${log?.checks?.engine}`);

// ---------------------------------------------------------------------------
console.log("\n=== 5. the block record (0013) ===");
const blk = night; // first night block; planned 01:00 on its day
const planned0 = blk.start_slot * 15;
const planned1 = (blk.start_slot + blk.dur_slots) * 15;
const rec = (who, extra) =>
  rpc("record_block", as(who, { p_plan_id: PLAN, p_block_id: blk.id, ...extra }));

for (const who of ["SrDEN/ECoR/WAT", "DRM/ECoR/WAT", "SrDOM/ECoR/KUR", "SrDOM/NR/LKO"]) {
  r = await rec(who, { p_state: "granted", p_granted_min: planned0 });
  check(`**${who} may not record Waltair's block**`, !r.ok, (r.message ?? "").slice(0, 70));
}
r = await rec("SrDOM/ECoR/WAT", { p_state: "granted", p_granted_min: planned0 + 12 });
check("Sr.DOM records the block granted, 12 minutes late", r.body?.state === "granted",
      `-> ${r.body?.state} at ${r.body?.granted_min} (planned ${planned0})`);
const bad = [
  ["returned before it was granted", { p_state: "completed", p_granted_min: planned0, p_returned_min: planned0 }, "cannot be returned before"],
  ["a block longer than a day", { p_state: "completed", p_granted_min: planned0, p_returned_min: planned0 + 1441 }, "longer than a day"],
  ["completed with no return time", { p_state: "completed", p_granted_min: planned0 }, "returned to traffic"],
  ["still on, yet with a return time", { p_state: "granted", p_granted_min: planned0, p_returned_min: planned1 }, "still on"],
  ["partial with no word on what was left", { p_state: "partial", p_granted_min: planned0, p_returned_min: planned1 }, "left undone"],
  ["not availed with no reason", { p_state: "not_availed" }, "why the block was not availed"],
  ["not availed, yet with times", { p_state: "not_availed", p_granted_min: planned0, p_note: "x" }, "no times"],
  ["granted outside the plan week", { p_state: "granted", p_granted_min: 7 * 1440 }, "within the plan week"],
  ["an unknown state", { p_state: "cancelled", p_granted_min: planned0 }, "unknown state"],
];
for (const [label, a, expect] of bad) {
  r = await rec("SrDOM/ECoR/WAT", a);
  check(`refused: ${label}`, !r.ok && r.message.includes(expect), (r.message ?? "accepted").slice(0, 70));
}
r = await rpc("record_block", as("SrDOM/ECoR/WAT", { p_plan_id: PLAN, p_block_id: "W-NO-SUCH", p_state: "granted", p_granted_min: 60 }));
check("refused: a block that is not in the plan", !r.ok && r.message.includes("not in this plan"), (r.message ?? "").slice(0, 60));

r = await rec("SrDOM/ECoR/WAT", { p_state: "completed", p_granted_min: planned0 + 12, p_returned_min: planned1 + 20 });
check("the same block, returned 20 minutes late: corrected in place", r.body?.state === "completed",
      `-> granted ${r.body?.granted_min}, returned ${r.body?.returned_min}`);
const corr = (await db.query(
  `select detail from audit_log where action = 'block.recorded' order by id desc limit 1`)).rows[0]?.detail;
check("**the log keeps what the correction replaced**", corr?.replaced?.state === "granted",
      `replaced ${JSON.stringify(corr?.replaced)}`);
const other = blocks.find((b) => b.id !== blk.id);
r = await rpc("record_block", as("SrDOM/ECoR/WAT", { p_plan_id: PLAN, p_block_id: other.id, p_state: "not_availed", p_note: "late running of 12246" }));
check("a block not availed, with its reason", r.body?.state === "not_availed", `-> ${r.body?.note}`);

const mine = await rpc("my_actuals", as("SrDEN/ECoR/WAT", { p_plan_id: PLAN }));
const gm = await rpc("my_actuals", as("GM/ECoR", { p_plan_id: PLAN }));
const kur = await rpc("my_actuals", as("SrDEN/ECoR/KUR", { p_plan_id: PLAN }));
const lko = await rpc("my_actuals", as("SrDEN/NR/LKO", { p_plan_id: PLAN }));
const n = (x) => (Array.isArray(x.body) ? x.body.length : x.body ? 1 : 0);
check("the division reads its record", n(mine) === 2, `${n(mine)} blocks recorded`);
check("the zone reads it too", n(gm) === 2, `${n(gm)}`);
check("**another division in the zone does not**", n(kur) === 0, `${n(kur)}`);
check("**another zone does not**", n(lko) === 0, `${n(lko)}`);
const direct = await db.query(`select relrowsecurity from pg_class where relname = 'block_actuals'`);
check("the table itself is closed (row level security on, no policy)",
      direct.rows[0]?.relrowsecurity === true);

r = await rpc("reset_plan", as("DRM/ECoR/WAT", { p_plan_id: PLAN }));
const left = (await db.query(`select count(*)::int as n from block_actuals where plan_id = '${PLAN}'`)).rows[0].n;
const resetLog = (await db.query(
  `select detail from audit_log where action = 'plan.reset' order by id desc limit 1`)).rows[0]?.detail;
check("a reset to draft clears the record, and logs how much",
      r.body?.status === "draft" && left === 0 && resetLog?.blocks_record_cleared === 2,
      `${left} left, ${resetLog?.blocks_record_cleared} cleared`);
r = await rec("SrDOM/ECoR/WAT", { p_state: "granted", p_granted_min: planned0 });
check("**a draft cannot be worked**", !r.ok && r.message.includes("only an approved plan"), (r.message ?? "").slice(0, 60));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
