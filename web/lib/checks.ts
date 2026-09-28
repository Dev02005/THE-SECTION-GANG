"use client";

import { useEffect, useState } from "react";
import type { PlanPayload } from "./plan";

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
