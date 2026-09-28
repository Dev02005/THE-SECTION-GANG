"use client";

import { useEffect, useState } from "react";
import { type DbChecks, checkPlan, isSupabaseConfigured } from "./db";
import type { PlanPayload } from "./plan";
import { useSession } from "./session";

/**
 * The pre-approval checks, as `engine/build_checks.py` wrote them.
 *
 * Run on the published plan itself, independently of the solver: the engine
 * module that runs them never sees the model. A plan that fails one is never
 * written by `build_plan`, and the approval panel will not submit or approve a
 * plan without a passing set that belongs to it.
 */
export interface PlanCheck {
  id: string;
  name: string;
  passed: boolean;
  examined: number;
  failed: number;
  failures: string[];
}

export interface ChecksPayload {
  schemaVersion: number;
  generatedAt: string;
  plan: { objective: number; seed: number; blocks: number; generatedAt: string };
  passed: boolean;
  checks: PlanCheck[];
}

/**
 * Whether these checks are OF this plan: the same solve (objective, seed),
 * the same build (generatedAt). Checks of another build say nothing about
 * this one, however green they are.
 */
export function checksMatch(c: ChecksPayload, plan: PlanPayload): boolean {
  return (
    c.plan.objective === plan.solver.objective &&
    c.plan.seed === plan.provenance.seed &&
    c.plan.generatedAt === plan.generatedAt
  );
}

export type ChecksState =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "ready"; checks: ChecksPayload };

/** Fetch the published checks once. Missing is a state, not an error. */
export function useChecks(): ChecksState {
  const [s, setS] = useState<ChecksState>({ state: "loading" });
  useEffect(() => {
    let live = true;
    fetch("/data/checks.json")
      .then((r) => (r.ok ? (r.json() as Promise<ChecksPayload>) : null))
      .then((c) => live && setS(c ? { state: "ready", checks: c } : { state: "missing" }))
      .catch(() => live && setS({ state: "missing" }));
    return () => {
      live = false;
    };
  }, []);
  return s;
}

/** True only for a passing set that belongs to this plan. */
export function checksClear(s: ChecksState, plan: PlanPayload): boolean {
  return s.state === "ready" && checksMatch(s.checks, plan) && s.checks.passed;
}

/**
 * The same plan, as the DATABASE will check it when someone presses Submit or
 * Approve (migration 0012).
 *
 *   none         no database, or no plan row - nothing enforces anything
 *   unavailable  a database without 0012: it does not re-check, and the page
 *                says so rather than implying it does
 *   ready        what submit_plan and decide_plan will find
 */
export type DbChecksState =
  | { state: "none" }
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "ready"; checks: DbChecks };

export function useDbChecks(planId: string | null): DbChecksState {
  const { session } = useSession();
  const [s, setS] = useState<DbChecksState>({ state: "none" });
  useEffect(() => {
    if (!isSupabaseConfigured || session === null || planId === null) {
      setS({ state: "none" });
      return;
    }
    let live = true;
    setS({ state: "loading" });
    checkPlan(session.credential, planId)
      .then((c) => live && setS(c ? { state: "ready", checks: c } : { state: "none" }))
      //  A missing function is the likeliest failure: a database not yet on
      //  0012. That is a fact to state, not a failure of the plan.
      .catch(() => live && setS({ state: "unavailable" }));
    return () => {
      live = false;
    };
  }, [session, planId]);
  return s;
}

/**
 * May Submit and Approve be offered? The engine's set must pass and belong to
 * this plan; and if the database has re-checked it, the database must agree.
 * The database refuses regardless - this only stops the page offering a
 * button that would be refused.
 */
export function approvalClear(
  s: ChecksState,
  db: DbChecksState,
  plan: PlanPayload,
): boolean {
  return checksClear(s, plan) && !(db.state === "ready" && !db.checks.passed);
}
