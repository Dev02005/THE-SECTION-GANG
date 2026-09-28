"use client";

import { useCallback, useEffect, useState } from "react";
import { type DbActual, isSupabaseConfigured, myActuals } from "./db";
import type { PlanBlock } from "./plan";
import { useSession } from "./session";

/**
 * The plan as worked: planned against actual, block by block.
 *
 * TIME. Everything here is minutes from 00:00 on the Monday that begins the
 * plan week. The plan's own slots use that origin (slot x 15), and the engine
 * takes day 0 as a Monday, so a planned block and its record compare with no
 * calendar convention that nothing else in the system has.
 */
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY = 1440;

export function plannedStart(b: PlanBlock): number {
  return b.startSlot * 15;
}
export function plannedEnd(b: PlanBlock): number {
  return (b.startSlot + b.durSlots) * 15;
}

/** 72 -> "01:12"; the day is shown separately where it matters. */
export function hhmm(min: number): string {
  const m = ((min % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export function dayOf(min: number): number {
  return Math.floor(min / DAY);
}
/** 72 -> "Mon 01:12". */
export function stamp(min: number): string {
  return `${DAYS[dayOf(min) % 7]} ${hhmm(min)}`;
}
/** Day index and "HH:MM" back to minutes; null for a malformed time. */
export function toMinutes(day: number, time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return day * DAY + h * 60 + mm;
}
/** "+12", "-5", "on time" - late is positive. */
export function delta(min: number): string {
  if (min === 0) return "on time";
  return `${min > 0 ? "+" : "−"}${Math.abs(min)} min`;
}

export type ActualsState =
  | { state: "none" }
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "ready"; rows: DbActual[] };

/**
 * The record for one plan row. `none` without a database or a row; a
 * database before 0013 has no `my_actuals` and is reported as unavailable,
 * not as an empty record - "nothing recorded" and "cannot record" are
 * different answers.
 */
export function useActuals(planId: string | null): ActualsState & { refresh: () => void } {
  const { session } = useSession();
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const [s, setS] = useState<ActualsState>({ state: "none" });
  useEffect(() => {
    if (!isSupabaseConfigured || session === null || planId === null) {
      setS({ state: "none" });
      return;
    }
    let live = true;
    myActuals(session.credential, planId)
      .then((rows) => live && setS({ state: "ready", rows }))
      .catch(() => live && setS({ state: "unavailable" }));
    return () => {
      live = false;
    };
  }, [session, planId, nonce]);
  return { ...s, refresh };
}

export interface Summary {
  recorded: number;
  total: number;
  grantedLate: number;
  grantedLateMin: number;
  returnedLate: number;
  returnedLateMin: number;
  notAvailed: number;
  partial: number;
  /** Over blocks given AND returned: minutes used against minutes planned. */
  usedMin: number;
  plannedMinOfUsed: number;
}

/**
 * Every figure computed from what was recorded, and only from that. A block
 * with no record is counted as unrecorded - never as on time.
 */
export function summarise(blocks: PlanBlock[], rows: DbActual[]): Summary {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const s: Summary = {
    recorded: 0,
    total: blocks.length,
    grantedLate: 0,
    grantedLateMin: 0,
    returnedLate: 0,
    returnedLateMin: 0,
    notAvailed: 0,
    partial: 0,
    usedMin: 0,
    plannedMinOfUsed: 0,
  };
  for (const a of rows) {
    const b = byId.get(a.block_id);
    if (!b) continue;
    s.recorded++;
    if (a.state === "not_availed") s.notAvailed++;
    if (a.state === "partial") s.partial++;
    if (a.granted_min !== null) {
      const late = a.granted_min - plannedStart(b);
      if (late > 0) {
        s.grantedLate++;
        s.grantedLateMin += late;
      }
    }
    if (a.granted_min !== null && a.returned_min !== null) {
      const late = a.returned_min - plannedEnd(b);
      if (late > 0) {
        s.returnedLate++;
        s.returnedLateMin += late;
      }
      s.usedMin += a.returned_min - a.granted_min;
      s.plannedMinOfUsed += plannedEnd(b) - plannedStart(b);
    }
  }
  return s;
}
