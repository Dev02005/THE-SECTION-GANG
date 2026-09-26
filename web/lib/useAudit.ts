"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type DbAuditRow,
  DbUnreachableError,
  isSupabaseConfigured,
  myAudit,
} from "./db";
import { useSession } from "./session";

/**
 * The audit log for the signed-in post's zone.
 *
 * Modelled on `useDivisions`, including the part that matters: with no
 * database this returns an EMPTY list and `live: false`, so the page can say
 * "there is no database here" rather than drawing a plausible history out of
 * a generated file. An invented audit trail would be the worst thing in this
 * application to invent - the whole point of the page is that it records what
 * actually happened.
 *
 * `refresh` exists because this list changes as a result of actions taken
 * elsewhere in the same session: submit a plan on the planner, come back, and
 * the entry should be there. Re-mounting would fetch anyway; the button is for
 * the case where a judge submits in one tab and watches in another.
 */
export interface AuditState {
  rows: DbAuditRow[];
  loading: boolean;
  /** False when no database is configured, so the caller can say so. */
  live: boolean;
  error: string | null;
  /**
   * The database is configured but the request never arrived. Kept apart from
   * `error` because the page says different things: a query that failed is a
   * fault to report, an unreachable host means the history is simply not
   * known from here - and neither is an empty log.
   */
  unreachable: boolean;
  refresh: () => void;
}

export function useAudit(limit = 50): AuditState {
  const { session, ready } = useSession();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Omit<AuditState, "refresh">>({
    rows: [],
    loading: true,
    live: false,
    error: null,
    unreachable: false,
  });

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!ready) return;
    if (!isSupabaseConfigured || session === null) {
      setState({
        rows: [],
        loading: false,
        live: false,
        error: null,
        unreachable: false,
      });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    myAudit(session.credential, limit)
      .then((rows) => {
        if (!cancelled) {
          setState({
            rows,
            loading: false,
            live: true,
            error: null,
            unreachable: false,
          });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const gone = e instanceof DbUnreachableError;
        setState({
          rows: [],
          loading: false,
          live: false,
          //  An unreachable host is not a query fault, so it is not reported
          //  as one. Saying "the log could not be read: Failed to fetch"
          //  invites the reader to look for a bug in the query.
          error: gone
            ? null
            : e instanceof Error
              ? e.message
              : "could not reach the database",
          unreachable: gone,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [ready, session, limit, nonce]);

  return { ...state, refresh };
}
