/**
 * Does the credential check and the zone scoping actually hold?
 *
 * Written to try to BREAK it, not to confirm it. Every assertion that matters
 * here is an attempt to see something the caller should not: another zone's
 * plan, a table without a credential, a write without authority. A test that
 * only checks the happy path would pass on a system with no security at all.
 */
const fs = require("node:fs");
//  These scripts test a LIVE database, so they need its URL and key. On a
//  fresh clone there is no .env.local, and the bare readFileSync used to die
//  with an ENOENT stack trace that said nothing about what was missing.
if (!fs.existsSync(".env.local")) {
  console.error("No .env.local here. These checks run against a live Supabase project.");
  console.error("Copy .env.example to .env.local and fill in the two values (see README).");
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf-8").split(/\r?\n/)
    .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const PW = "block@2026";

async function rpc(fn, args) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: H, body: JSON.stringify(args),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function table(t) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`, { headers: H });
  return { status: r.status, body: await r.text() };
}

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? "PASS" : "**FAIL**"}  ${label}${detail ? "  " + detail : ""}`);
}

(async () => {
  console.log("=== 1. the credential itself ===");
  let r = await rpc("sign_in", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW });
  check("correct password signs in", Array.isArray(r.body) && r.body.length === 1,
        r.body?.[0] ? `-> ${r.body[0].designation}, ${r.body[0].division_name}` : JSON.stringify(r.body).slice(0,60));
  r = await rpc("sign_in", { p_officer_id: "SrDEN/ECoR/WAT", p_password: "wrong" });
  check("wrong password is refused", Array.isArray(r.body) && r.body.length === 0);
  r = await rpc("sign_in", { p_officer_id: "NoSuchPost/XX/YY", p_password: PW });
  check("unknown officer is refused", Array.isArray(r.body) && r.body.length === 0);

  console.log("\n=== 2. tables are shut without a credential ===");
  for (const t of ["officers", "plans", "blocks", "zones", "stations"]) {
    const q = await table(t);
    const empty = q.body === "[]" || q.status === 401 || q.status === 403;
    check(`direct read of ${t} yields nothing`, empty, `HTTP ${q.status} ${q.body.slice(0, 28)}`);
  }

  console.log("\n=== 3. zone scoping - the important one ===");
  const ecor = await rpc("my_zone", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW });
  check("ECoR officer sees ECoR", ecor.body?.[0]?.code === "ECoR",
        `-> ${ecor.body?.[0]?.name} (${ecor.body?.[0]?.divisions?.length} divisions)`);
  const nr = await rpc("my_zone", { p_officer_id: "SrDEN/NR/LKO", p_password: PW });
  check("NR officer sees NR, not ECoR", nr.body?.[0]?.code === "NR",
        `-> ${nr.body?.[0]?.name} (${nr.body?.[0]?.divisions?.length} divisions)`);

  const ep = await rpc("my_plan", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW });
  const hasPlan = ep.body && ep.body.plan;
  check("Waltair officer gets the plan", !!hasPlan,
        hasPlan ? `-> ${ep.body.plan.reference}, ${ep.body.blocks.length} blocks` : "none");
  const np = await rpc("my_plan", { p_officer_id: "SrDEN/NR/LKO", p_password: PW });
  check("**Northern Railway officer gets NO plan**", np.body === null,
        np.body === null ? "(correct - the plan is ECoR's)" : "LEAK: " + JSON.stringify(np.body).slice(0, 60));

  const kur = await rpc("my_plan", { p_officer_id: "SrDEN/ECoR/KUR", p_password: PW });
  check("Khurda Road officer gets no plan (same zone, other division)", kur.body === null,
        kur.body === null ? "(correct)" : "LEAK");
  const gm = await rpc("my_plan", { p_officer_id: "GM/ECoR", p_password: PW });
  check("GM of ECoR DOES see the zone's plan", !!(gm.body && gm.body.plan),
        gm.body?.plan ? `-> ${gm.body.plan.reference}` : "none");

  //  The planner screen reads `payload`, not the rows, so an empty payload
  //  would leave a signed-in Waltair officer looking at "no plan held" while
  //  the tables plainly hold one. Check the blob is there AND that it agrees
  //  with the rows beside it - they are written by one seed in one
  //  transaction, so a mismatch means someone re-ran half of it.
  const pay = ep.body?.payload ?? null;
  check("the plan carries its render payload", pay !== null && Array.isArray(pay?.optimised?.blocks),
        pay ? `-> ${pay.optimised.blocks.length} blocks, ${pay.sections?.length} sections`
            : "null - run 0007_plan_payload.sql then re-run 0004_seed_plan.sql");
  if (pay) {
    const rowBlocks = (ep.body.blocks ?? []).filter((b) => b.variant === "optimised").length;
    check("payload and rows describe the same plan",
          pay.optimised.blocks.length === rowBlocks,
          `payload ${pay.optimised.blocks.length} vs rows ${rowBlocks}`);
    //  The four things the screen needs and no table holds. Keyed OBJECTS,
    //  not arrays - the first version of this assertion guessed `explanations`
    //  was a list and failed against perfectly good data.
    const surface = Object.keys(pay.detentionSurface ?? {}).length;
    const expl = Object.keys(pay.explanations ?? {}).length;
    check("payload carries what no table holds",
          surface > 0 && expl > 0 && !!pay.provenance?.modelMetrics && Array.isArray(pay.pareto?.points),
          `${surface} surface rows, ${expl} explanations, ${pay.pareto?.points?.length} pareto points`);
  }
  //  The blob must not become a side door: it is returned only through
  //  my_plan, so another zone must get null here too, not an empty envelope.
  //  THREE outcomes, not two. A missing function answers HTTP 404 with a
  //  PGRST code and no `payload` key - which satisfied "payload is absent"
  //  and PASSED, for the wrong reason, while printing "LEAK" on the same
  //  line. A check whose note contradicts its own verdict is reporting
  //  nothing, and passing because the routine is absent is the same defect
  //  this file was already written once to avoid.
  const npAnswered = np.status < 400;
  const npLeaked = npAnswered && np.body !== null && np.body?.payload != null;
  check(
    "**another zone gets no payload either**",
    npAnswered && !npLeaked,
    !npAnswered
      ? `no answer to read - HTTP ${np.status} ${np.body?.code ?? ""}`.trim()
      : npLeaked
        ? "LEAK: payload returned to NR"
        : np.body === null
          ? "(no bundle at all)"
          : "(bundle, no payload)",
  );

  console.log("\n=== 3b. the zone view (migration 0008) ===");
  const gmDivs = await rpc("my_divisions", { p_officer_id: "GM/ECoR", p_password: PW });
  const ok0008 = Array.isArray(gmDivs.body);
  check("migration 0008 is applied", ok0008,
        ok0008 ? "my_divisions and my_plan_for present"
               : "my_divisions missing - run 0008_zone_view.sql");

  //  Everything below asks whether a SCOPE holds. Run without the functions,
  //  each would compare an error object against null, fail, and print LEAK -
  //  a missing migration reported as a security hole. Guarded, so the suite
  //  says what is actually wrong.
  if (ok0008) {
    const denDivs = await rpc("my_divisions", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW });
    const nrDivs = await rpc("my_divisions", { p_officer_id: "SrDEN/NR/UMB", p_password: PW });
    check("**a zonal post sees every division in its zone**", gmDivs.body.length === 3,
          gmDivs.body.map((d) => `${d.division_code}:${d.plan_id ? "plan" : "none"}`).join(" "));
    check("a division with no plan is a row, not a missing row",
          gmDivs.body.filter((d) => d.plan_id === null).length === 2,
          `${gmDivs.body.filter((d) => d.plan_id === null).length} of ${gmDivs.body.length} hold nothing`);
    check("a divisional post sees only its own division",
          Array.isArray(denDivs.body) && denDivs.body.length === 1 && denDivs.body[0]?.division_code === "WAT",
          Array.isArray(denDivs.body) ? denDivs.body.map((d) => d.division_code).join(",") : "-");
    check("**another zone's divisions never appear**",
          Array.isArray(nrDivs.body) && !nrDivs.body.some((d) => ["WAT", "KUR", "SBP"].includes(d.division_code)),
          Array.isArray(nrDivs.body) ? `${nrDivs.body.length} rows, none from ECoR` : "-");

    //  The whole reason 0008 exists: a GM can OPEN a named division rather
    //  than being handed whichever plan happened to be newest.
    const gmWat = await rpc("my_plan_for", { p_officer_id: "GM/ECoR", p_password: PW, p_division_code: "WAT" });
    const gmKur = await rpc("my_plan_for", { p_officer_id: "GM/ECoR", p_password: PW, p_division_code: "KUR" });
    check("a GM can open a named division", !!gmWat.body?.plan,
          gmWat.body?.plan ? `WAT -> ${gmWat.body.plan.reference}` : "none");
    check("and gets null for one that holds nothing", gmKur.body === null,
          gmKur.body === null ? "KUR -> null (correct)" : "LEAK");
    const denKur = await rpc("my_plan_for", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW, p_division_code: "KUR" });
    const nrWat = await rpc("my_plan_for", { p_officer_id: "SrDEN/NR/UMB", p_password: PW, p_division_code: "WAT" });
    check("**a divisional post cannot name another division**", denKur.body === null,
          denKur.body === null ? "(pinned to WAT inside the query)" : "LEAK");
    check("**another zone cannot name into this one**", nrWat.body === null,
          nrWat.body === null ? "(correct)" : "LEAK: NR read WAT");
  }

  console.log("\n=== 4. scoped directory and stations ===");
  const off = await rpc("my_officers", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW });
  check("directory is scoped", Array.isArray(off.body) && off.body.length > 0 && off.body.length < 425,
        `-> ${off.body?.length} officers (of 425)`);
  //  This assertion used to be `Array.isArray(st.body)`, which passed on an
  //  empty table - a test that could not fail is not a test. Two questions
  //  now, kept apart because they fail for different reasons: is the master
  //  loaded at all, and do two zones actually see different stations.
  const st = await rpc("my_stations", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW });
  const rows = Array.isArray(st.body) ? st.body : [];
  check("station master is loaded", rows.length > 0,
        rows.length > 0 ? `-> ${rows.length} stations in ECoR`
                        : "0 rows - 0003b_seed_stations.sql has not been run (only /network needs it)");
  //  `my_stations` returns no zone column - the join applies the scope, so
  //  carrying it back would be redundant. The first version of this assertion
  //  filtered on `s.zone_code` anyway and marked all 313 rows foreign, which
  //  says something about the test and nothing about the data.
  //
  //  Test the property instead of a field: two officers of different zones
  //  must come back with sets that do not overlap. That cannot pass on an
  //  unscoped query, and it needs no column to be exposed.
  const nrSt = await rpc("my_stations", { p_officer_id: "SrDEN/NR/UMB", p_password: PW });
  const nrRows = Array.isArray(nrSt.body) ? nrSt.body : [];
  const ecorCodes = new Set(rows.map((s) => s.code));
  const overlap = nrRows.filter((s) => ecorCodes.has(s.code));
  check("**two zones see disjoint sets of stations**",
        rows.length > 0 && nrRows.length > 0 && overlap.length === 0,
        `ECoR ${rows.length}, NR ${nrRows.length}, in both ${overlap.length}`);

  //  NR comes back as exactly 1000, which is not a station count - it is
  //  PostgREST's db-max-rows cap, and the truncation is silent. ECoR (313) and
  //  SR (718) are under it and are real. Nothing consumes my_stations today,
  //  so nothing on screen is wrong; this exists so that the next person to
  //  wire it up reads 1000 as a ceiling rather than an answer, and paginates.
  if (nrRows.length === 1000) {
    //  A NOTE, not a check. The first version of this was a check with `|| true`
    //  in its condition, which can never fail - the exact weak assertion this
    //  file exists to catch, and it would have inflated the pass count by one.
    console.log("  NOTE      NR returns exactly 1000: PostgREST's db-max-rows cap, not a count.");
    console.log("            Truncation is silent. Nothing calls my_stations yet; paginate first.");
  }

  console.log("\n=== 4b. changing a password (migration 0009) ===");
  //  A THROWAWAY POST, and put back afterwards. This is the live shared
  //  database: a test that leaves a password changed locks that post for the
  //  next person to open the deployed site, and the sign-in page still prints
  //  the old one. The restore runs in a finally so a failure halfway does not
  //  strand it either.
  const VICTIM = "SrDOM/SR/MAS";
  const NEWPW = "corridor-test-9081";
  let pw0009 = await rpc("change_password", { p_officer_id: VICTIM, p_password: PW, p_new_password: NEWPW });
  //  PostgREST answers a missing routine with code PGRST202, not with the
  //  wording I first matched on - so the guard was true when the function did
  //  not exist, and two assertions below then PASSED because a 404 is also
  //  status >= 400. Passing for the wrong reason is the same defect as failing
  //  for the wrong reason; test the code.
  const has0009 = pw0009.body?.code !== "PGRST202";
  check("migration 0009 is applied", has0009,
        has0009 ? "change_password present" : "run 0009_password.sql");

  if (has0009) {
    try {
      check("the password actually changed", pw0009.body === true,
            JSON.stringify(pw0009.body).slice(0, 40));
      let r1 = await rpc("sign_in", { p_officer_id: VICTIM, p_password: PW });
      check("**the old password stops working**", Array.isArray(r1.body) && r1.body.length === 0,
            r1.body?.length === 0 ? "(refused)" : "STILL ACCEPTED");
      let r2 = await rpc("sign_in", { p_officer_id: VICTIM, p_password: NEWPW });
      check("the new password works", Array.isArray(r2.body) && r2.body.length === 1,
            r2.body?.[0] ? `-> ${r2.body[0].designation}` : "refused");
      let r3 = await rpc("change_password", { p_officer_id: VICTIM, p_password: NEWPW, p_new_password: "short" });
      check("a password under 8 characters is refused", r3.status >= 400,
            (r3.body?.message ?? "").slice(0, 44));
      let r4 = await rpc("change_password", { p_officer_id: "SrDEN/ECoR/WAT", p_password: "wrong", p_new_password: NEWPW });
      check("**a wrong current password cannot change one**", r4.status >= 400,
            (r4.body?.message ?? "").slice(0, 44));
    } finally {
      const back = await rpc("restore_demo_password", { p_officer_id: VICTIM, p_password: NEWPW });
      const ok = await rpc("sign_in", { p_officer_id: VICTIM, p_password: PW });
      check("restore puts the demonstration password back",
            back.body === true && Array.isArray(ok.body) && ok.body.length === 1,
            ok.body?.length === 1 ? "(signed in with block@2026 again)" : "**LEFT CHANGED**");
    }
  }


  console.log("\n=== 4c. the approval chain, end to end (migration 0010) ===");
  //  The one plan on a shared instance, so this walks the whole cycle and puts
  //  it back to draft in a finally. Without 0010 there is no way back at all -
  //  every transition was one-way - which is why the reset exists.
  const PLAN = ep.body?.plan?.id;
  let probe = await rpc("reset_plan", { p_officer_id: "DRM/ECoR/WAT", p_password: PW, p_plan_id: PLAN });
  const has0010 = probe.body?.code !== "PGRST202";
  check("migration 0010 is applied", has0010,
        has0010 ? "reset_plan present" : "run 0010_approval_cycle.sql");

  if (has0010 && PLAN) {
    try {
      let r = await rpc("submit_plan", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW, p_plan_id: PLAN });
      check("Sr.DEN submits a draft", r.body?.status === "submitted", `-> ${r.body?.status}`);

      //  THE property, tested at the one moment it can fail: the plan is now
      //  SUBMITTED, so a DRM could decide it. Being a DRM must not be enough.
      //  This was verified once by hand and then described as if the suite
      //  covered it - it did not, so it does now.
      for (const who of ["DRM/ECoR/KUR", "DRM/NR/UMB"]) {
        const d = await rpc("decide_plan", { p_officer_id: who, p_password: PW, p_plan_id: PLAN, p_approve: true });
        check(`**${who} cannot approve Waltair's plan**`, d.status >= 400,
              (d.body?.message ?? "").slice(0, 40));
      }
      r = await rpc("decide_plan", { p_officer_id: "DRM/ECoR/WAT", p_password: PW, p_plan_id: PLAN, p_approve: false });
      check("**a rejection with no reason is refused**", r.status >= 400,
            (r.body?.message ?? "").slice(0, 40));
      r = await rpc("decide_plan", { p_officer_id: "DRM/ECoR/WAT", p_password: PW, p_plan_id: PLAN, p_approve: false, p_reason: "tower wagon double-booked on Thursday" });
      check("the DRM sends it back with a reason", r.body?.status === "rejected",
            `-> ${r.body?.status}, "${(r.body?.decision_reason ?? "").slice(0, 24)}…"`);
      r = await rpc("submit_plan", { p_officer_id: "SrDSTE/ECoR/WAT", p_password: PW, p_plan_id: PLAN });
      check("a rejected plan can be revised and brought again", r.body?.status === "submitted",
            `-> ${r.body?.status}, decision cleared: ${r.body?.decision_reason === null}`);
      r = await rpc("decide_plan", { p_officer_id: "DRM/ECoR/WAT", p_password: PW, p_plan_id: PLAN, p_approve: true });
      check("the DRM approves it", r.body?.status === "approved", `-> ${r.body?.status}`);
      r = await rpc("submit_plan", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW, p_plan_id: PLAN });
      check("**an approved plan cannot be submitted again**", r.status >= 400,
            (r.body?.message ?? "").slice(0, 40));
      r = await rpc("reset_plan", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW, p_plan_id: PLAN });
      check("**only the DRM may reset**", r.status >= 400, (r.body?.message ?? "").slice(0, 40));
    } finally {
      const back = await rpc("reset_plan", { p_officer_id: "DRM/ECoR/WAT", p_password: PW, p_plan_id: PLAN });
      check("the plan is left as a draft", back.body?.status === "draft",
            back.body?.status === "draft" ? "(the next visitor gets the whole cycle)" : "**LEFT MID-CHAIN**");
    }
  }


  console.log("\n=== 4d. the database checks the plan (migration 0012) ===");
  //  Read-only on the live plan, plus the pure rule function handed a broken
  //  copy. Breaking the STORED rows is check-sql.mjs's job, on a database of
  //  its own - never this one, which visitors are using.
  const chk = await rpc("check_plan", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW, p_plan_id: PLAN });
  const has0012 = chk.body?.code !== "PGRST202";
  check("migration 0012 is applied", has0012, has0012 ? "check_plan present" : "run 0012_plan_checks.sql");
  if (has0012 && PLAN) {
    const rules = chk.body?.rules ?? [];
    check("**the database re-runs its rules and the plan passes them all**",
          rules.length > 0 && rules.every((x) => x.passed),
          rules.map((x) => `${x.id}${x.passed ? "" : "(FAIL)"}`).join(" "));
    const e = chk.body?.engine ?? {};
    check("the engine's record is stored, passing, and of this plan",
          e.present && e.belongs && e.passed,
          e.present ? `${e.checks} checks, belongs: ${e.belongs}`
                    : "none stored - re-run 0004_seed_plan.sql after 0012");
    const nrChk = await rpc("check_plan", { p_officer_id: "SrDEN/NR/LKO", p_password: PW, p_plan_id: PLAN });
    check("**another zone cannot read this plan's checks**", nrChk.body === null,
          nrChk.body === null ? "(null)" : "LEAK");
    //  Two optimised blocks on one section, moved onto each other.
    const bl = (ep.body.blocks ?? []).filter((b) => b.variant === "optimised");
    const y = bl.find((b) => bl.some((x) => x.id < b.id && x.section_id === b.section_id));
    const x = bl.find((b) => b.id < y.id && b.section_id === y.section_id);
    const broken = bl.map((b) => (b.id === y.id
      ? { ...b, start_slot: x.start_slot, dur_slots: x.dur_slots, scope: "SECTION" } : b));
    const pure = await rpc("plan_rule_checks", {
      p_blocks: broken, p_tasks: ep.body.tasks, p_paths: ep.body.protectedPaths,
      p_shortfall: ep.body.payload?.shortfall ?? [], p_horizon_days: ep.body.plan.horizon_days,
    });
    const c7 = Array.isArray(pure.body) ? pure.body.find((r) => r.id === "C7") : null;
    check("**handed two blocks on one road, the live database fails C7**", c7 && !c7.passed,
          c7?.failures?.[0] ?? JSON.stringify(pure.body).slice(0, 60));
  }

  console.log("\n=== 4e. the block record (migration 0013) ===");
  const act0 = await rpc("my_actuals", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW, p_plan_id: PLAN });
  const has0013 = act0.body?.code !== "PGRST202";
  check("migration 0013 is applied", has0013, has0013 ? "record_block present" : "run 0013_block_record.sql");
  if (has0013 && has0012 && PLAN) {
    const blk = (ep.body.blocks ?? []).find((b) => b.variant === "optimised");
    const rec = (who, extra) => rpc("record_block", {
      p_officer_id: who, p_password: PW, p_plan_id: PLAN, p_block_id: blk.id, ...extra });
    try {
      let r = await rec("SrDOM/ECoR/WAT", { p_state: "granted", p_granted_min: blk.start_slot * 15 });
      check("**a draft cannot be worked**", r.status >= 400, (r.body?.message ?? "").slice(0, 50));
      await rpc("submit_plan", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW, p_plan_id: PLAN });
      r = await rpc("decide_plan", { p_officer_id: "DRM/ECoR/WAT", p_password: PW, p_plan_id: PLAN, p_approve: true });
      check("approved through the database's checks", r.body?.status === "approved", `-> ${r.body?.status ?? r.body?.message}`);
      r = await rec("SrDEN/ECoR/WAT", { p_state: "granted", p_granted_min: blk.start_slot * 15 });
      check("**Sr.DEN may not record a block**", r.status >= 400, (r.body?.message ?? "").slice(0, 50));
      r = await rec("SrDOM/ECoR/KUR", { p_state: "granted", p_granted_min: blk.start_slot * 15 });
      check("**another division's Sr.DOM may not either**", r.status >= 400, (r.body?.message ?? "").slice(0, 50));
      r = await rec("SrDOM/ECoR/WAT", { p_state: "completed", p_granted_min: blk.start_slot * 15 + 10,
                                         p_returned_min: blk.start_slot * 15 + 5 });
      check("**returned before granted is refused**", r.status >= 400, (r.body?.message ?? "").slice(0, 50));
      r = await rec("SrDOM/ECoR/WAT", { p_state: "granted", p_granted_min: blk.start_slot * 15 + 10 });
      check("Sr.DOM records the block granted", r.body?.state === "granted", `-> ${r.body?.state} at ${r.body?.granted_min}`);
      const own = await rpc("my_actuals", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW, p_plan_id: PLAN });
      const nrA = await rpc("my_actuals", { p_officer_id: "SrDEN/NR/LKO", p_password: PW, p_plan_id: PLAN });
      check("the division reads it", Array.isArray(own.body) && own.body.length === 1, `${own.body?.length}`);
      check("**another zone does not**", Array.isArray(nrA.body) && nrA.body.length === 0, `${nrA.body?.length}`);
    } finally {
      const back = await rpc("reset_plan", { p_officer_id: "DRM/ECoR/WAT", p_password: PW, p_plan_id: PLAN });
      const left = await rpc("my_actuals", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW, p_plan_id: PLAN });
      check("reset leaves a draft with no record",
            back.body?.status === "draft" && Array.isArray(left.body) && left.body.length === 0,
            back.body?.status === "draft" ? `(record: ${left.body?.length})` : "**LEFT MID-CHAIN**");
    }
  }


  console.log("\n=== 5. writes need authority ===");
  const planId = ep.body?.plan?.id;
  if (planId) {
    let w = await rpc("submit_plan", { p_officer_id: "SrDEN/ECoR/WAT", p_password: "wrong", p_plan_id: planId });
    check("submit with a bad password is refused", w.status >= 400, `HTTP ${w.status}`);
    w = await rpc("submit_plan", { p_officer_id: "SrDOM/ECoR/WAT", p_password: PW, p_plan_id: planId });
    check("Sr.DOM may not submit", w.status >= 400, (w.body?.message ?? "").slice(0, 46));
    w = await rpc("decide_plan", { p_officer_id: "SrDEN/ECoR/WAT", p_password: PW, p_plan_id: planId, p_approve: true });
    check("Sr.DEN may not approve", w.status >= 400, (w.body?.message ?? "").slice(0, 46));
    w = await rpc("submit_plan", { p_officer_id: "SrDEN/NR/LKO", p_password: PW, p_plan_id: planId });
    check("an officer of another zone may not submit it", w.status >= 400, (w.body?.message ?? "").slice(0, 46));
  } else {
    check("plan id available for write tests", false, "no plan returned");
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
