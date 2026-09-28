import { isSupabaseConfigured, supabase } from "./supabase";
import type { Department, PlanPayload, Road } from "./plan";

/**
 * Every call the application makes to the database.
 *
 * There is no table access here and none anywhere else - the tables are shut
 * to the publishable key, and each function below is a Postgres routine that
 * takes the caller's credential and returns only what that post is entitled
 * to. The scope is applied inside the query, so it is not something the client
 * can opt out of by editing what runs in the browser.
 *
 * The credential travels with every call rather than being exchanged once for
 * a token. That is a deliberate consequence of having no server: there is
 * nowhere to hold a session, so the alternative to re-sending it would be to
 * trust the browser's word about who it is, which is what this replaces.
 */

export interface Officer {
  id: string;
  post: string;
  designation: string;
  full_name: string;
  level: "zone" | "division";
  zone_code: string;
  division_code: string | null;
  department: Department | null;
  remit: string;
  zone_name: string;
  division_name: string | null;
}

export interface Credential {
  officerId: string;
  password: string;
}

/** Shapes returned by `my_plan`, which mirror the tables. */
export interface DbBlock {
  id: string;
  variant: "optimised" | "baseline";
  section_id: string;
  scope: Road | "SECTION";
  day: number;
  start_slot: number;
  dur_slots: number;
  start_hhmm: string;
  end_hhmm: string;
  detention_min: number;
  clubbed: boolean;
  departments: Department[];
}

export interface DbTask {
  id: string;
  variant: "optimised" | "baseline";
  department: Department;
  section_id: string;
  activity: string;
  criticality: "A" | "B" | "C";
  scheduled: boolean;
  block_id: string | null;
  start_slot: number | null;
  /** Where the work ends. Absent before 0012, null on a deferred job. */
  end_slot?: number | null;
  risk_rate: number;
}

export interface DbKpis {
  blocks: number;
  block_hours: number;
  detention_minutes: number;
  detention_per_task: number;
  risk_carried: number;
  scheduled: number;
  statutory_done: number;
  statutory_total: number;
  multidept_pct: number;
  packing: number;
}

export interface DbPlanBundle {
  plan: {
    id: string;
    reference: string;
    zone_code: string;
    division_code: string;
    horizon_days: number;
    seed: number | null;
    status: "draft" | "submitted" | "approved" | "rejected" | "superseded";
    solver_status: string | null;
    objective: number | null;
    bound: number | null;
    placement_objective: number | null;
    placement_bound: number | null;
    generated_at: string;
    submitted_by: string | null;
    decided_by: string | null;
    decision_reason: string | null;
    /**
     * SHA-256 of the plan's blocks and tasks, written by the seed. Optional
     * and nullable for the same reason as `payload`: a database before 0011
     * returns no such key, and a row seeded before it carries null.
     */
    plan_hash?: string | null;
  };
  /**
   * The engine artefact as the screen renders it.
   *
   * A projection of the rows above plus the detention surface, the per-block
   * explanations and the Pareto sweep - things no table holds because nothing
   * but the planner ever wants them, and it always wants all of them at once.
   * Written by the same seed, in the same transaction, as the rows; it cannot
   * describe a different plan from the one beside it.
   *
   * OPTIONAL, and the `?` is load-bearing. A database still on the migration
   * before 0007 returns a bundle with no `payload` key at all, so this is
   * `undefined` there rather than null - and a `=== null` check slides straight
   * past undefined into code that then dereferences it. Declaring it `| null`
   * only was how that shipped once already.
   */
  payload?: PlanPayload | null;
  sections: { id: string; name: string; km_from: number; km_to: number }[];
  kpis: Record<"optimised" | "baseline", DbKpis>;
  blocks: DbBlock[];
  tasks: DbTask[];
  protectedPaths: {
    train: string;
    name: string;
    entry_min: number;
    exit_min: number;
    days_per_week: number;
  }[];
}

export interface Zone {
  code: string;
  name: string;
  hq: string;
  year: number;
  divisions: { code: string; name: string }[];
}

/**
 * `null` when the database is not configured, so every caller has to decide
 * what to do without it rather than assuming it is there. The application
 * falls back to the static artefact, which is why a clone with no credentials
 * still builds and runs.
 */
function client() {
  return isSupabaseConfigured ? supabase : null;
}

export { isSupabaseConfigured };

/**
 * The database was configured but could not be reached at all.
 *
 * Distinct from every other failure on purpose. A refusal from Postgres is an
 * ANSWER - this post may not do that, that plan is another zone's - and must
 * be shown as one. A host that does not resolve is not an answer; it means we
 * learned nothing, and the caller is entitled to know the difference before
 * deciding what to put on screen.
 *
 * This is not hypothetical. The free-tier project behind this build stopped
 * resolving (NXDOMAIN, not a timeout) while the application went on treating
 * it as configured, so sign-in failed outright instead of degrading.
 */
export class DbUnreachableError extends Error {
  constructor(readonly fn: string, message: string) {
    super(message);
    this.name = "DbUnreachableError";
  }
}

/**
 * The messages a browser gives for "the request never got there".
 *
 * Chrome says "Failed to fetch", Firefox "NetworkError when attempting to
 * fetch resource.", Safari "Load failed", undici "fetch failed". Matching on
 * text is crude, but supabase-js reports a transport failure and a SQL error
 * through the same `error` object, and getting this wrong in the other
 * direction - treating a refusal as unreachable - would turn "you may not see
 * this" into a fallback that shows something. So the list is deliberately
 * narrow: anything unrecognised stays an ordinary error.
 */
function looksUnreachable(message: string): boolean {
  return /failed to fetch|networkerror|fetch failed|load failed/i.test(message);
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const c = client();
  if (c === null) return null;
  const { data, error } = await c.rpc(fn, args);
  if (error) {
    //  Surfaced, not swallowed. A silent failure here would look exactly like
    //  "this officer is not entitled to see anything", which is the one wrong
    //  conclusion to draw from a broken query.
    console.error(`rpc ${fn} failed`, error.message);
    if (looksUnreachable(error.message)) {
      throw new DbUnreachableError(fn, error.message);
    }
    throw new Error(error.message);
  }
  return (data ?? null) as T | null;
}

function args(cred: Credential, extra: Record<string, unknown> = {}) {
  return { p_officer_id: cred.officerId, p_password: cred.password, ...extra };
}

/** Verify a credential. Returns the officer, or null if it is wrong. */
export async function signIn(cred: Credential): Promise<Officer | null> {
  const rows = await call<Officer[]>("sign_in", args(cred));
  return rows && rows.length > 0 ? rows[0] : null;
}

/** The caller's zone and the divisions inside it. */
export async function myZone(cred: Credential): Promise<Zone | null> {
  const rows = await call<Zone[]>("my_zone", args(cred));
  return rows && rows.length > 0 ? rows[0] : null;
}

/**
 * The plan this officer may see.
 *
 * `null` is a real answer, not an error: an officer of a division with no
 * solved plan gets nothing, and so does an officer of another zone. The UI
 * distinguishes the two by what it already knows about the signed-in post.
 */
export async function myPlan(
  cred: Credential,
  divisionCode?: string | null,
): Promise<DbPlanBundle | null> {
  //  Naming a division only narrows a ZONAL post's choice; a divisional post
  //  is pinned to its own whatever it asks for, and the pinning is in the
  //  query rather than here, where it could be edited away.
  if (divisionCode === undefined || divisionCode === null) {
    return call<DbPlanBundle>("my_plan", args(cred));
  }
  return call<DbPlanBundle>(
    "my_plan_for",
    args(cred, { p_division_code: divisionCode }),
  );
}

/**
 * The approval chain, which Postgres enforces rather than this file.
 *
 * `submit_plan` accepts only Sr.DEN, Sr.DSTE or Sr.DEE of that plan's own
 * division, and only while it is a draft. `decide_plan` accepts only that
 * division's DRM, and only once it has been submitted; a rejection without a
 * reason is refused. Both write to an append-only audit log.
 *
 * None of those rules live here. This file cannot enforce anything - it runs
 * in a browser - so it sends the credential and reports what the database
 * decides. Hiding a button is courtesy; the refusal is what makes it true.
 */
export async function submitPlan(cred: Credential, planId: string) {
  return call("submit_plan", args(cred, { p_plan_id: planId }));
}

/**
 * Put a plan back to draft. The DRM only, and a DEMONSTRATION affordance: no
 * railway un-approves a programme, it supersedes it. It exists because this
 * instance is shared and holds one plan, so without it the chain could be
 * exercised exactly once and then never again.
 */
export async function resetPlan(cred: Credential, planId: string) {
  return call("reset_plan", args(cred, { p_plan_id: planId }));
}

export async function decidePlan(
  cred: Credential,
  planId: string,
  approve: boolean,
  reason?: string,
) {
  return call(
    "decide_plan",
    args(cred, {
      p_plan_id: planId,
      p_approve: approve,
      p_reason: reason ?? null,
    }),
  );
}

/**
 * Every division the caller may see, each with its current plan or nulls.
 *
 * A zonal post gets the whole zone; a divisional post gets its own division,
 * so one call serves both and there is no branch here to get wrong.
 *
 * A division with no plan comes back as a ROW WITH NULLS rather than as a
 * missing row. The absence is the answer - it is how a GM learns that two of
 * his three divisions have nothing, which is a fact about this instance and
 * not something to tidy out of the list.
 */
export interface DbDivisionRow {
  division_code: string;
  division_name: string;
  plan_id: string | null;
  reference: string | null;
  status: DbPlanBundle["plan"]["status"] | null;
  generated_at: string | null;
  blocks: number | null;
  statutory_done: number | null;
  statutory_total: number | null;
  detention_min: number | null;
}

export async function myDivisions(cred: Credential): Promise<DbDivisionRow[]> {
  return (await call<DbDivisionRow[]>("my_divisions", args(cred))) ?? [];
}
export async function changePassword(
  cred: Credential,
  newPassword: string,
): Promise<void> {
  await call("change_password", args(cred, { p_new_password: newPassword }));
}

/**
 * Put the shared demonstration password back.
 *
 * This database is shared and the sign-in page prints that password, so a
 * change made by one visitor would otherwise leave the post locked for
 * everyone else. This is the way back.
 */
export async function restoreDemoPassword(cred: Credential): Promise<void> {
  await call("restore_demo_password", args(cred));
}

/**
 * One entry in the append-only audit log.
 *
 * The column names are prefixed because the routine's RETURNS TABLE names are
 * in scope inside its own body, so a column called `actor` beside a table
 * aliased `actor` makes `actor.id` ambiguous and Postgres refuses the script.
 * The prefix is not decoration; it is why the function compiles.
 */
export interface DbAuditRow {
  log_at: string;
  log_actor: string;
  log_action: string;
  log_entity: string;
  log_entity_id: string | null;
  log_detail: Record<string, unknown> | null;
}

/**
 * The audit log this officer may read.
 *
 * ZONE-SCOPED, not division-scoped, and the page says so rather than implying
 * otherwise. `my_audit` joins each entry to the officer who wrote it and keeps
 * the ones whose zone matches the caller's, so a Sr.DEN of Waltair sees what
 * Khurda Road's officers did too. That is deliberate - a zone's officers are
 * accountable to the same GM - but it is not what "my log" would suggest.
 *
 * Two consequences of the query worth knowing at the call site. It is an INNER
 * join to `officers`, so an entry whose actor is null is invisible here; the
 * column is nullable but nothing in the schema writes a null actor. And the
 * limit is clamped to 200 inside Postgres, so asking for more is not an error,
 * it just does not get you more.
 */
export async function myAudit(
  cred: Credential,
  limit = 50,
): Promise<DbAuditRow[]> {
  return (await call<DbAuditRow[]>("my_audit", args(cred, { p_limit: limit }))) ?? [];
}

/**
 * One pre-approval rule as the DATABASE re-ran it (0012). The same keys the
 * engine writes into checks.json, so one component renders both.
 */
export interface DbRule {
  id: string;
  name: string;
  passed: boolean;
  examined: number;
  failed: number;
  failures: string[];
}

/**
 * What `submit_plan` and `decide_plan` will look at: the rules the database
 * re-runs over its own rows, and the engine's record it requires for the rest.
 */
export interface DbChecks {
  passed: boolean;
  rules: DbRule[];
  engine: {
    present: boolean;
    belongs: boolean;
    passed: boolean;
    checks: number;
    failing: string[];
  };
}

/**
 * The checks the database will apply to this plan, read without moving it.
 *
 * Null for a plan this post may not see - scoped like `my_plan`. A database
 * before 0012 has no such function and throws, which the caller reports as
 * "not re-checked by the database" rather than as a failure.
 */
export async function checkPlan(cred: Credential, planId: string): Promise<DbChecks | null> {
  return call<DbChecks>("check_plan", args(cred, { p_plan_id: planId }));
}

/** Where a block stands on the ground. See 0013_block_record.sql. */
export type BlockState = "granted" | "completed" | "partial" | "not_availed";

/**
 * One block as worked. Times are minutes from 00:00 on the Monday that begins
 * the plan week - the origin the plan's own slots use - so planned and actual
 * compare without a calendar the rest of the system does not have.
 */
export interface DbActual {
  plan_id: string;
  block_id: string;
  state: BlockState;
  granted_min: number | null;
  returned_min: number | null;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

/** The record of an approved plan, for any post that may see the plan. */
export async function myActuals(cred: Credential, planId: string): Promise<DbActual[]> {
  return (await call<DbActual[]>("my_actuals", args(cred, { p_plan_id: planId }))) ?? [];
}

/**
 * Record a block. The Sr.DOM of the plan's own division, on an APPROVED plan,
 * and nobody else - enforced in `record_block`, which also refuses times that
 * contradict the state and writes the value it replaces to the audit log.
 */
export async function recordBlock(
  cred: Credential,
  planId: string,
  blockId: string,
  state: BlockState,
  grantedMin: number | null,
  returnedMin: number | null,
  note: string | null,
): Promise<DbActual | null> {
  return call<DbActual>(
    "record_block",
    args(cred, {
      p_plan_id: planId,
      p_block_id: blockId,
      p_state: state,
      p_granted_min: grantedMin,
      p_returned_min: returnedMin,
      p_note: note,
    }),
  );
}
