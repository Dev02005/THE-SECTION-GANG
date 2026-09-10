"use client";

import { useEffect, useState } from "react";
import { type DbDivisionRow, isSupabaseConfigured, myDivisions } from "./db";
import { useSession } from "./session";

/**
 * Every division this post may see, each with its current plan or nulls.
 *
 * A zonal post gets the whole zone; a divisional post gets its own division.
 * The same call serves both because the scope is decided in Postgres, so there
 * is no branch here that could be wrong.
 *
 * A division with NO plan arrives as a row of nulls, not as a missing row, and
 * that is the point: it is how a General Manager learns that two of his three
 * divisions hold nothing. Dropping those rows would leave a list that looks
 * complete and is not.
 *
 * Without a database this returns an empty list rather than an invented one.
 * The panel that reads it then says so, instead of drawing a zone summary out
 * of a generated file - which is what it used to do, and which meant the
 * "plans held here" figure could not have been wrong even if the database
 * disagreed with it.
 */
export interface DivisionsState {
  rows: DbDivisionRow[];
  loading: boolean;
  /** False when no database is configured, so the caller can say so. */
  live: boolean;
  error: string | null;
}

export function useDivisions(): DivisionsState {
  const { session, ready } = useSession();
  const [state, setState] = useState<DivisionsState>({
    rows: [],
    loading: true,
    live: false,
    error: null,
  });

  useEffect(() => {
    if (!ready) return;
    if (!isSupabaseConfigured || session === null) {
      setState({ rows: [], loading: false, live: false, error: null });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    myDivisions(session.credential)
      .then((rows) => {
        if (!cancelled) {
          setState({ rows, loading: false, live: true, error: null });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          rows: [],
          loading: false,
          live: false,
          error: e instanceof Error ? e.message : "could not reach the database",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [ready, session]);

  return state;
}
