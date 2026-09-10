"use client";

import { useEffect, useState } from "react";
import type { Credential, Officer, Zone } from "./db";
import { isSupabaseConfigured, myZone, signIn } from "./db";
import { DEMO_PASSWORD, ROLES, type Role, roleById } from "./roles";
import { zoneByCode } from "./railways";

/**
 * Who is signed in, and the credential their requests carry.
 *
 * Held in localStorage rather than a cookie or a server session, because the
 * site is statically rendered and there is no server to hold one. The
 * credential is re-sent with every call, which is what lets Postgres apply the
 * scope: the alternative would be to trust the browser's claim about which
 * post it is, and that is precisely what this replaces.
 *
 * THE PASSWORD IS STORED IN THE BROWSER. It is the same demonstration password
 * for all 425 posts and it is printed on the sign-in page, so keeping it in
 * localStorage reveals nothing that page does not. It would be the wrong shape
 * for a real credential, and a deployment authenticating officers properly
 * would exchange it once for a token rather than keep it - said here rather
 * than left for someone to discover in the code.
 *
 * Reads are wrapped because localStorage throws outright in some contexts
 * (private windows with site data blocked, thumbnail capture), and a sign-in
 * convenience must never be able to take the page down.
 */
const KEY = "corridor.session";
const EVENT = "corridor:session";

export interface Session {
  officer: Officer;
  credential: Credential;
  zone: Zone | null;
}

interface Stored {
  officerId: string;
  password: string;
  officer: Officer;
  zone: Zone | null;
}

export function readSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return null;
    const s = JSON.parse(raw) as Stored;
    if (!s?.officer?.id) return null;
    return {
      officer: s.officer,
      credential: { officerId: s.officerId, password: s.password },
      zone: s.zone ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Verify a credential against the database and, if it holds, remember it.
 *
 * Returns null on a bad credential. The check happens in Postgres - this
 * function cannot decide the answer, only report it.
 */
/**
 * OFFLINE DEMONSTRATION MODE - used only when no database is configured.
 *
 * A clone with no Supabase project used to dead-end at the sign-in page: the
 * RPC layer returns null when it has no client, so every credential came back
 * as "That officer ID and password do not match" - a false error, on the first
 * page, for anyone evaluating the repository. Everything behind the gate was
 * unreachable, including the static-artefact fallback built precisely so a
 * clone would still run.
 *
 * So without a database the credential is checked against the generated
 * directory in roles.ts instead. That is a check in the BROWSER, and it is
 * weaker than the real one in every way that matters - which is why it can
 * never run when a database is configured, and why every page it reaches says
 * "offline demonstration mode". It reveals nothing new: the directory and the
 * one demonstration password are printed on the sign-in page already, and the
 * static plan it unlocks is a public file.
 */
function offlineOfficer(officerId: string, password: string): Officer | null {
  const id = officerId.trim().toLowerCase();
  //  Case-insensitive and trimmed, exactly as `_officer` matches in Postgres,
  //  so the two modes accept the same input.
  const role = ROLES.find((r) => r.userId.toLowerCase() === id) ?? null;
  if (role === null || password !== DEMO_PASSWORD) return null;
  return {
    id: role.userId,
    post: role.userId.split("/")[0],
    designation: role.designation,
    full_name: role.full,
    level: role.level,
    zone_code: role.zone.code,
    division_code: role.division?.code ?? null,
    department: role.department,
    remit: role.remit,
    zone_name: role.zone.name,
    division_name: role.division?.name ?? null,
  };
}

export async function authenticate(
  officerId: string,
  password: string,
): Promise<Session | null> {
  const credential: Credential = { officerId, password };
  const officer = isSupabaseConfigured
    ? await signIn(credential)
    : offlineOfficer(officerId, password);
  if (officer === null) return null;
  const zone = await myZone(credential).catch(() => null);
  const session: Session = { officer, credential, zone };
  try {
    const stored: Stored = { officerId, password, officer, zone };
    window.localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* signing in is a convenience; losing it is not an error */
  }
  window.dispatchEvent(new Event(EVENT));
  return session;
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
    //  The theme is a signed-in officer's preference, and the control that
    //  sets it is hidden while nobody is. Leaving the choice behind would give
    //  the next visitor to this browser a theme they cannot see or change.
    window.localStorage.removeItem("corridor-theme");
    //  And take it off the page, not just out of storage. The control now
    //  lives inside the account menu, so signing out UNMOUNTS it - its own
    //  effect can no longer do this, and the page stayed dark until reload.
    document.documentElement.removeAttribute("data-theme");
  } catch {
    /* as above */
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * `ready` is false until after hydration. Components must render the
 * signed-out view first: the server has no idea who this is, so painting a
 * name on the first pass would be a hydration mismatch.
 */
export function useSession(): { session: Session | null; ready: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setSession(readSession());
    sync();
    setReady(true);
    //  `storage` covers other tabs; the custom event covers this one.
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return { session, ready };
}

/**
 * The database officer expressed in the shape the existing components read.
 *
 * An adapter rather than a rewrite of every panel: the officer now comes from
 * Postgres, but `designation`, `remit` and the zone/division names mean the
 * same thing they did when they came from a generated file, so the components
 * that display them do not need to change.
 */
export function asRole(session: Session | null): Role | null {
  if (session === null) return null;
  const o = session.officer;
  //  The generated directory still describes the post; the database is
  //  authoritative for whether this credential is real.
  const known = roleById(o.id);
  if (known !== null) return known;
  const zone = zoneByCode(o.zone_code);
  if (zone === null) return null;
  return {
    userId: o.id,
    password: "",
    designation: o.designation,
    full: o.full_name,
    department: o.department,
    remit: o.remit,
    level: o.level,
    zone,
    division:
      o.division_code === null
        ? null
        : (zone.divisions.find((d) => d.code === o.division_code) ?? null),
    hasPlan: false,
  };
}
