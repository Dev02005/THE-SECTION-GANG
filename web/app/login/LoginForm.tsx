"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { type Role, rolesFor } from "@/lib/roles";
import {
  REFERENCE_DIVISION,
  REFERENCE_ZONE,
  ZONES,
  zoneByCode,
} from "@/lib/railways";
import { asRole, authenticate, useSession } from "@/lib/session";

const ZONE_HQ = "__hq__";

/**
 * Zone, then division or the zone headquarters, then the post. Three lists.
 *
 * The posts used to sit open on the page as five cards, which put the whole
 * directory in front of someone who only needed one line of it. They are a
 * third select now: the hierarchy is still what you navigate, but you read one
 * post at a time - the one you have chosen - rather than all of them at once.
 *
 * The hierarchy IS the point and stays visible. Choosing Bhusaval and finding
 * five real officers with no plan behind them says more about what this system
 * is than any amount of prose: the structure is national, the solved instance
 * is one division of sixty-eight.
 */
export function LoginForm() {
  const router = useRouter();
  //  Guarded pages send you here with ?next=, so signing in returns you to
  //  the page you actually asked for rather than always the planner.
  const params = useSearchParams();
  const { session, ready } = useSession();
  const current = asRole(session);
  const [busy, setBusy] = useState(false);
  const [zoneCode, setZoneCode] = useState(REFERENCE_ZONE);
  const [divCode, setDivCode] = useState<string>(REFERENCE_DIVISION);
  const [postId, setPostId] = useState<string>("");
  //  Lazy initialiser so the form is submittable on first paint: without it
  //  the password only appeared after the post select was touched.
  const [password, setPassword] = useState(
    () => rolesFor(REFERENCE_ZONE, REFERENCE_DIVISION)[0]?.password ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const zone = zoneByCode(zoneCode);
  const posts = useMemo(
    () => rolesFor(zoneCode, divCode === ZONE_HQ ? null : divCode),
    [zoneCode, divCode],
  );
  //  Never trust the held id across a change of list: falling back to the
  //  first post keeps the form always ready to submit, and keeps the id shown
  //  underneath honest about which post is actually selected.
  const selected: Role | null =
    posts.find((p) => p.userId === postId) ?? posts[0] ?? null;

  function choose(post: Role | null) {
    setPostId(post?.userId ?? "");
    //  One demonstration password for all 425 posts, and it is printed below,
    //  so filling it is a convenience rather than a disclosure.
    setPassword(post?.password ?? "");
    setError(null);
  }

  function pickZone(code: string) {
    setZoneCode(code);
    //  Metro Railway has no divisions, so its only posts are at the zone.
    const first = zoneByCode(code)?.divisions[0];
    const nextDiv = first === undefined ? ZONE_HQ : first.code;
    setDivCode(nextDiv);
    choose(rolesFor(code, nextDiv === ZONE_HQ ? null : nextDiv)[0] ?? null);
  }

  function pickDivision(code: string) {
    setDivCode(code);
    choose(rolesFor(zoneCode, code === ZONE_HQ ? null : code)[0] ?? null);
  }

  //  The credential goes to Postgres. This function cannot decide the answer,
  //  only report it - which is the whole point of moving the check out of the
  //  browser, where a determined user could edit it.
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected === null) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await authenticate(
        selected.userId,
        password || selected.password,
      );
      if (ok === null) {
        setError("That officer ID and password do not match.");
        return;
      }
      const next = params.get("next");
      router.push(next && next.startsWith("/") ? next : "/planner");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not reach the database.",
      );
    } finally {
      setBusy(false);
    }
  }

  const field =
    "rounded border border-rule bg-surface px-2.5 py-2 text-[13.5px] text-ink outline-none focus-visible:border-accent";
  const label =
    "font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-mut";

  return (
    <form onSubmit={submit} className="mt-8 max-w-[640px]">
      {ready && current !== null && (
        <p className="mb-4 rounded border border-rule bg-surface-sunk px-3 py-2 text-[12.5px] text-ink-mid">
          Signed in as <strong className="text-ink">{current.designation}</strong>
          {current.division !== null && ` · ${current.division.name}`}
          {current.level === "zone" && ` · ${current.zone.code}`}. Choosing
          another post replaces it.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={label}>Zone — {ZONES.length} total</span>
          <select
            value={zoneCode}
            onChange={(e) => pickZone(e.target.value)}
            className={field}
          >
            {ZONES.map((zn) => (
              <option key={zn.code} value={zn.code}>
                {zn.name} ({zn.code})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={label}>
            Division — {zone?.divisions.length ?? 0} in this zone
          </span>
          <select
            value={divCode}
            onChange={(e) => pickDivision(e.target.value)}
            className={field}
          >
            <option value={ZONE_HQ}>
              Zone headquarters — {zone?.hq ?? ""}
            </option>
            {zone?.divisions.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1.5">
        <span className={label}>
          Post — the {divCode === ZONE_HQ ? "five zonal" : "five divisional"}{" "}
          posts
        </span>
        <select
          value={selected?.userId ?? ""}
          onChange={(e) =>
            choose(posts.find((p) => p.userId === e.target.value) ?? null)
          }
          className={field}
        >
          {posts.map((r) => (
            <option key={r.userId} value={r.userId}>
              {r.designation} — {r.full}
            </option>
          ))}
        </select>
      </label>

      {selected !== null && (
        <div className="mt-2.5 rounded border border-rule bg-surface-sunk px-3 py-2.5">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-[12.5px] text-ink">
              {selected.userId}
            </span>
            <span className="font-mono text-[11px] text-ink-faint">
              {selected.password}
            </span>
            {selected.level === "division" && selected.hasPlan && (
              <span className="rounded bg-accent-soft px-1.5 font-mono text-[10px] text-accent">
                plan solved
              </span>
            )}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-mid">
            {selected.remit}
          </p>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className={label}>Password — same for every post</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            className={field}
          />
        </label>
        <button
          type="submit"
          disabled={busy || selected === null}
          className="rounded bg-accent px-6 py-2 text-[13.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </div>

      <p role="status" className="min-h-[18px] pt-1.5 text-[12.5px] text-danger">
        {error}
      </p>

      {divCode !== ZONE_HQ && divCode !== REFERENCE_DIVISION && (
        <p className="mt-1 rounded border border-rule bg-surface-sunk px-3 py-2 text-[12px] leading-relaxed text-ink-mut">
          These are real posts, and this instance holds{" "}
          <strong className="text-ink-mid">no plan</strong> for this division.
          Signing in shows that rather than another division&rsquo;s numbers.
          Waltair is the one division solved here.
        </p>
      )}
    </form>
  );
}
