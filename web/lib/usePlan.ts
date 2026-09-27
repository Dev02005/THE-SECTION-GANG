"use client";

import { useCallback, useEffect, useState } from "react";
import { DbUnreachableError, isSupabaseConfigured, myPlan } from "./db";
import { type PlanPayload, planReference } from "./plan";
import { REFERENCE_DIVISION, REFERENCE_ZONE } from "./railways";
import { useSession } from "./session";

/**
 * The plan this officer is entitled to see.
 *
 * Four outcomes, and the second is the point of the whole exercise:
 *
 *   plan          the database returned one for this post's division
 *   null          it did not - another zone's plan, or a division with none
 *   fallback      no database configured: the static artefact, scoped the
 *                 same way the database would scope it
 *   matched       the row is this post's but its payload is missing, and the
 *                 artefact carries the same plan reference, so it stands in
 *
 * The distinction between "no plan" and "not your plan" is deliberately NOT
 * made here. Postgres answers null in both cases and does not say which,
 * because telling an officer of Northern Railway that East Coast has a plan
 * they may not see is itself a disclosure. The UI reads the signed-in post to
 * phrase it.
 *
 * The fallback is why a clone with no credentials still works. It is not a
 * degraded mode bolted on: it is the path the application used before the
 * database existed, kept because a repository that cannot run is one nobody
 * can review.
 */
export type PlanSource =
  /** Row and render payload both came from `my_plan`, scoped to this post. */
  | "database"
  /**
   * No database configured: offline demonstration mode. The static artefact,
   * given only to the posts Postgres would give it to - Waltair's own, and
   * East Coast Railway's zonal posts. Everyone else gets null, as online.
   */
  | "artefact"
  /**
   * The row came from the database and belongs to this post, but its render
   * payload is missing - a half-applied migration. The artefact is drawn
   * instead, and ONLY after checking that it carries the same plan reference
   * as the row. Substituting a plan we merely happen to be holding for one we
   * could not read is the manufactured-result failure this whole gate exists
   * to prevent, so the match is the condition, not a nicety.
   */
  | "artefact-matched"
  /**
   * A database IS configured and could not be reached at all - the host did
   * not resolve, or the request never left. Not a refusal: a refusal is an
   * answer and is obeyed. We learned nothing, so this post gets exactly what
   * it would get with no database configured, under the same entitlement
   * rule, and the page says the record could not be read rather than letting
   * a fallback pass for the live plan.
   */
  | "artefact-unreachable"
  | "none";

export interface PlanState {
  plan: PlanPayload | null;
  source: PlanSource;
  loading: boolean;
  error: string | null;
  /** The plan row, for status and the approval chain. Absent on the fallback. */
  record: {
    id: string;
    reference: string;
    status: string;
    division_code: string;
    zone_code: string;
    submitted_by: string | null;
    decided_by: string | null;
    decision_reason: string | null;
    plan_hash?: string | null;
  } | null;
  /**
   * Re-read the plan. The approval panel calls this after submitting or
   * deciding, because the status it just changed sits on the row it is
   * showing - without it the screen keeps saying "draft" over a plan that has
   * just been submitted.
   */
  refresh: () => void;
}

export function usePlan(
  fallback: PlanPayload,
  /**
   * Which division to read. Only a zonal post can move this: a divisional post
   * is pinned to its own division inside the query, so passing another
   * division's code from here changes nothing.
   */
  divisionCode?: string | null,
): PlanState {
  const { session, ready } = useSession();
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const [state, setState] = useState<Omit<PlanState, "refresh">>({
    plan: null,
    source: "none",
    loading: true,
    error: null,
    record: null,
  });

  useEffect(() => {
    if (!ready) return;

    //  Offline demonstration mode. The static artefact is Waltair's plan, so
    //  it goes only to the posts Postgres would give it to: a divisional post
    //  of Waltair, or a zonal post of East Coast Railway. Handing it to every
    //  post - which this branch used to do - would show Ambala Waltair's
    //  numbers, the exact relabelling the database refuses.
    const offline = (source: PlanSource) => {
      const o = session?.officer ?? null;
      const entitled =
        o !== null &&
        o.zone_code === REFERENCE_ZONE &&
        (o.level === "zone" || o.division_code === REFERENCE_DIVISION);
      setState({
        plan: entitled ? fallback : null,
        source,
        loading: false,
        error: null,
        record: null,
      });
    };

    if (!isSupabaseConfigured) {
      offline("artefact");
      return;
    }
    if (session === null) {
      setState({ plan: null, source: "none", loading: false, error: null, record: null });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    myPlan(session.credential, divisionCode)
      .then((bundle) => {
        if (cancelled) return;
        if (bundle === null) {
          //  Entitled to nothing here. Not an error - the correct answer for a
          //  division without a plan, and for every officer of another zone.
          setState({ plan: null, source: "database", loading: false, error: null, record: null });
          return;
        }
        const record = bundle.plan as PlanState["record"];
        //  `?? null` because a database on the migration before 0007 omits the
        //  key entirely, which is undefined and not null.
        const payload = bundle.payload ?? null;
        if (payload === null) {
          //  The row is this post's - my_plan would have returned null
          //  otherwise - but the blob is absent. Draw the artefact only if it
          //  is demonstrably the same plan.
          const same =
            record !== null && record.reference === planReference(fallback);
          setState({
            plan: same ? fallback : null,
            source: same ? "artefact-matched" : "database",
            loading: false,
            error: null,
            record,
          });
          return;
        }
        setState({
          plan: payload,
          source: "database",
          loading: false,
          error: null,
          record,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        //  Unreachable is not the same as refused. If the request never
        //  arrived we know nothing, so fall back to exactly what this post
        //  would see with no database at all - same entitlement rule, no
        //  plan row, and a source the page names out loud. Any other failure
        //  is something Postgres said, and gets shown as the error it is.
        if (e instanceof DbUnreachableError) {
          offline("artefact-unreachable");
          return;
        }
        setState({
          plan: null,
          source: "none",
          loading: false,
          error: e instanceof Error ? e.message : "could not reach the database",
          record: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [ready, session, fallback, divisionCode, nonce]);

  return { ...state, refresh };
}
