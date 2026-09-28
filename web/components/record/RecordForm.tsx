"use client";

import { useState } from "react";
import { type BlockState, type DbActual, recordBlock } from "@/lib/db";
import { DAYS, dayOf, hhmm, plannedEnd, plannedStart, toMinutes } from "@/lib/actuals";
import type { PlanBlock } from "@/lib/plan";
import type { Credential } from "@/lib/db";

const STATES: { value: BlockState; label: string }[] = [
  { value: "completed", label: "Completed — work done" },
  { value: "partial", label: "Partial — work left" },
  { value: "granted", label: "Granted — block on now" },
  { value: "not_availed", label: "Not availed" },
];

/**
 * Record one block, as the operating branch would enter it.
 *
 * Opened on the planned times, because most blocks are given close to plan
 * and retyping the day is where a wrong day gets entered. Every rule is the
 * DATABASE's: `record_block` refuses a return before the grant, a partial
 * block with no word on what was left, a block not availed with no reason -
 * and its sentence is shown here as it comes back. Nothing below enforces
 * anything; it only asks for what the database will ask for.
 */
export function RecordForm({
  block,
  existing,
  planId,
  credential,
  onSaved,
  onCancel,
}: {
  block: PlanBlock;
  existing: DbActual | null;
  planId: string;
  credential: Credential;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const g0 = existing?.granted_min ?? plannedStart(block);
  const r0 = existing?.returned_min ?? plannedEnd(block);
  const [state, setState] = useState<BlockState>(existing?.state ?? "completed");
  const [gDay, setGDay] = useState(dayOf(g0));
  const [gTime, setGTime] = useState(hhmm(g0));
  const [rDay, setRDay] = useState(dayOf(r0));
  const [rTime, setRTime] = useState(hhmm(r0));
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timed = state !== "not_availed";
  const returned = state === "completed" || state === "partial";
  const noteLabel =
    state === "not_availed"
      ? "Why was it not availed? (required)"
      : state === "partial"
        ? "What work was left? (required)"
        : "Note (optional)";

  async function save() {
    const g = timed ? toMinutes(gDay, gTime) : null;
    const r = returned ? toMinutes(rDay, rTime) : null;
    if ((timed && g === null) || (returned && r === null)) {
      setError("Times are HH:MM, 24-hour.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordBlock(credential, planId, block.id, state, g, r, note.trim() || null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The database refused that.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "rounded border border-rule bg-surface px-2 py-1 text-[12.5px] text-ink outline-none focus-visible:border-accent";
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded border border-rule bg-surface-sunk p-3">
      <label className="flex flex-col gap-1 text-[11px] text-ink-mut">
        State
        <select value={state} onChange={(e) => setState(e.target.value as BlockState)} className={field}>
          {STATES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </label>
      {timed && (
        <When label="Granted" day={gDay} time={gTime} setDay={setGDay} setTime={setGTime} cls={field} />
      )}
      {returned && (
        <When label="Returned to traffic" day={rDay} time={rTime} setDay={setRDay} setTime={setRTime} cls={field} />
      )}
      <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[11px] text-ink-mut">
        {noteLabel}
        <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
      </label>
      <span className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="rounded px-2 py-1.5 text-[12.5px] text-ink-mut hover:text-ink">
          Cancel
        </button>
      </span>
      {error !== null && (
        <p role="status" className="w-full text-[12px] text-danger">{error}</p>
      )}
    </div>
  );
}

function When({
  label, day, time, setDay, setTime, cls,
}: {
  label: string;
  day: number;
  time: string;
  setDay: (d: number) => void;
  setTime: (t: string) => void;
  cls: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1 text-[11px] text-ink-mut">
      <legend className="mb-1">{label}</legend>
      <span className="flex gap-1.5">
        <select aria-label={`${label}: day`} value={day} onChange={(e) => setDay(Number(e.target.value))} className={cls}>
          {DAYS.map((d, i) => (
            <option key={d} value={i}>{d}</option>
          ))}
        </select>
        <input
          aria-label={`${label}: time`}
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className={`${cls} tnum`}
        />
      </span>
    </fieldset>
  );
}
