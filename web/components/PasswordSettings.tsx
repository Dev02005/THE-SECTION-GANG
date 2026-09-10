"use client";

import { useState } from "react";
import { changePassword, restoreDemoPassword } from "@/lib/db";
import { DEMO_PASSWORD } from "@/lib/roles";
import { authenticate, useSession } from "@/lib/session";

/**
 * Change this post's own password, and put the shared one back.
 *
 * A REAL DEPLOYMENT HAS NEITHER. Every officer already holds an HRMS employee
 * ID, and an internal application on RailNet authenticates against that
 * directory - so resetting a password is an HRMS action and there would be
 * nothing here to reset. This is the demonstration equivalent: the same
 * credential check, the same bcrypt storage, the same audit entry, so the
 * shape of the operation is real even though the directory behind it is not.
 *
 * The restore button is not a convenience. This database is shared by everyone
 * who opens the site, and the sign-in page prints the demonstration password -
 * so one visitor changing it would leave that post locked for the next. The way
 * back has to be one click, and it has to be here rather than in a runbook.
 *
 * On success the session is re-established with the new credential. Every
 * later call carries the password, so skipping that would leave a signed-in
 * officer holding one the database no longer accepts - working until the next
 * read, then failing for a reason nobody could guess.
 */
export function PasswordSettings() {
  const { session } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (session === null) return null;

  const field =
    "w-full rounded border border-rule bg-surface px-2 py-1.5 font-mono text-[12.5px] text-ink outline-none focus-visible:border-accent";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (session === null) return;
    if (next !== confirm) {
      setMsg({ ok: false, text: "The two new passwords do not match." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await changePassword(
        { officerId: session.officer.id, password: current },
        next,
      );
      //  Re-sign in so the held credential matches what the database now has.
      await authenticate(session.officer.id, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ ok: true, text: "Password changed, and you are still signed in." });
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Could not change it.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (session === null) return;
    setBusy(true);
    setMsg(null);
    try {
      await restoreDemoPassword(session.credential);
      await authenticate(session.officer.id, DEMO_PASSWORD);
      setMsg({ ok: true, text: "The demonstration password is back." });
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Could not restore it.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11.5px] leading-relaxed text-ink-mut">
        Applies to <strong className="text-ink-mid">{session.officer.id}</strong>{" "}
        only. Stored as a bcrypt hash; the change is logged, the password is
        not.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current password"
          aria-label="Current password"
          autoComplete="current-password"
          className={field}
        />
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="New password — 8 characters or more"
          aria-label="New password"
          autoComplete="new-password"
          className={field}
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat the new password"
          aria-label="Repeat the new password"
          autoComplete="new-password"
          className={field}
        />
        <button
          type="submit"
          disabled={busy || current === "" || next === ""}
          className="mt-0.5 rounded bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Working…" : "Change password"}
        </button>
      </form>

      <button
        type="button"
        onClick={restore}
        disabled={busy}
        className="rounded border border-rule px-3 py-1.5 text-[12px] text-ink-mid transition-colors hover:border-ink-mut hover:text-ink disabled:opacity-60"
      >
        Restore the demonstration password
      </button>

      {msg !== null && (
        <p
          role="status"
          className={`text-[11.5px] leading-relaxed ${msg.ok ? "text-go" : "text-danger"}`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
