"use client";

import Link from "next/link";
import { Dropdown } from "./Dropdown";
import { PasswordSettings } from "./PasswordSettings";
import { ThemeToggle } from "./ThemeToggle";
import { TOTAL_DIVISIONS, TOTAL_ZONES } from "@/lib/railways";
import { asRole, clearSession, useSession } from "@/lib/session";

/**
 * The pages that explain the system rather than show a division's plan.
 *
 * They live in this menu rather than as a second dropdown in the header: one
 * control on the right, not two side by side. Method and Limits are open to
 * anyone and linked from the landing page too - they appear here as well so a
 * signed-in officer does not have to go back to the front page to reach the
 * limitations of what they are reading.
 */
const DOCS = [
  { href: "/method", label: "Method", note: "How the optimiser decides" },
  { href: "/limits", label: "Limits", note: "What this system does not know" },
  { href: "/scale", label: "Scale", note: "How far it goes, and where it stops" },
  {
    href: "/network",
    label: "Network",
    //  Read, not typed: the third figure lives in the station file and is
    //  shown on that page from the file itself, so it is not restated here.
    note: `${TOTAL_ZONES} zones · ${TOTAL_DIVISIONS} divisions · the station master`,
  },
];

/**
 * The account control at the right of the header.
 *
 * Signed out it is a plain link, because there is nothing to be the account of.
 * Signed in it is an icon that opens the post's own record - who this is, which
 * division, which zone and from which headquarters - then the preferences that
 * belong to a person rather than to a page, then the way out.
 *
 * The identity block is worth being complete about. An account here is a POST,
 * not a person, and a post only means something with its division and zone
 * attached: there really are two Nagpur divisions and two Lucknow divisions on
 * the Ministry's list, which is why the officer id is zone-qualified and why
 * the zone is shown rather than assumed.
 */
export function AccountMenu() {
  const { session, ready } = useSession();
  const role = asRole(session);

  if (!ready) {
    //  Hold the row so the header does not jump when this resolves.
    return <span className="h-[30px] w-[76px]" aria-hidden="true" />;
  }

  if (role === null) {
    return (
      <Link
        href="/login"
        className="rounded border border-rule px-2.5 py-1.5 font-mono text-[11px] text-ink-mid transition-colors hover:border-ink-mut hover:text-ink"
      >
        Sign in
      </Link>
    );
  }

  return (
    <Dropdown
      label={`Account — ${role.designation}`}
      width="w-[320px]"
      trigger={
        <span className="flex items-center gap-2">
          <PersonIcon />
          <span className="hidden font-mono text-[11px] sm:inline">
            {role.designation}
          </span>
        </span>
      }
    >
      <p className="font-display text-[15px] font-bold leading-tight text-ink">
        {role.full}
      </p>
      <p className="mt-0.5 font-mono text-[11px] text-ink-mut">{role.userId}</p>

      <dl className="mt-3 flex flex-col gap-1.5 border-t border-rule-soft pt-2.5 text-[12.5px]">
        <Row k="Designation" v={role.designation} />
        <Row
          k={role.level === "zone" ? "Level" : "Division"}
          v={role.division?.name ?? "Zone headquarters"}
        />
        <Row k="Zone" v={`${role.zone.name} (${role.zone.code})`} />
        <Row k="Headquarters" v={role.zone.hq} />
        <Row k="Remit" v={role.remit} wrap />
      </dl>

      <Disclosure title="Settings">
        {/*  Two kinds of setting, and they are not the same kind of thing. A
             preference changes what this browser looks like and lives nowhere
             else; an account setting changes the credential in Postgres and is
             written to the audit log. Nesting them says which is which.  */}
        <Disclosure title="Preferences" nested>
          <div className="flex items-center justify-between gap-3 py-0.5">
            <span className="text-[12.5px] text-ink-mid">Theme</span>
            <ThemeToggle />
          </div>
        </Disclosure>
        <Disclosure title="Account settings" nested>
          <PasswordSettings />
        </Disclosure>
      </Disclosure>

      <Disclosure title="Docs">
        <ul className="flex flex-col">
          {DOCS.map((d) => (
            <li key={d.href}>
              <Link
                href={d.href}
                className="-mx-1 block rounded px-1 py-1 transition-colors hover:bg-surface-sunk"
              >
                <span className="block text-[13px] font-medium text-ink">
                  {d.label}
                </span>
                <span className="block text-[11.5px] leading-snug text-ink-mut">
                  {d.note}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Disclosure>

      <button
        type="button"
        onClick={clearSession}
        className="mt-3 w-full rounded border border-rule px-3 py-1.5 text-[12.5px] text-ink-mid transition-colors hover:border-ink-mut hover:text-ink"
      >
        Sign out
      </button>
    </Dropdown>
  );
}

/**
 * A collapsed section inside the account panel.
 *
 * `<details>` rather than a button and a piece of state, because the browser
 * already implements this correctly: it is keyboard-operable, it reports its
 * own expanded state to a screen reader, and it works with no JavaScript at
 * all. The only thing overridden is the default triangle, replaced by a
 * chevron that turns - which is why the marker is hidden twice, once for
 * WebKit's pseudo-element and once for the standard list-style.
 *
 * Closed by default. The panel was 578px tall with both sections open, which
 * on a short phone put the Sign out button off the bottom of the screen.
 */
function Disclosure({
  title,
  nested,
  children,
}: {
  title: string;
  /** A section inside a section: indented, ruled on the left, no top border. */
  nested?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      className={
        nested
          ? "group mt-2 border-l border-rule-soft pl-2.5 first:mt-0"
          : "group mt-3 border-t border-rule-soft pt-2.5"
      }
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mut transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <svg
          viewBox="0 0 10 6"
          aria-hidden="true"
          className="h-[6px] w-[10px] shrink-0 transition-transform group-open:rotate-180"
        >
          <path
            d="M1 1l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Row({ k, v, wrap }: { k: string; v: string; wrap?: boolean }) {
  return (
    <div
      className={
        wrap ? "flex flex-col gap-0.5" : "flex items-baseline justify-between gap-3"
      }
    >
      <dt className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mut">
        {k}
      </dt>
      <dd
        className={`text-ink ${wrap ? "text-[12px] leading-relaxed text-ink-mid" : "text-right"}`}
      >
        {v}
      </dd>
    </div>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-[17px] w-[17px]">
      <circle
        cx="10"
        cy="6.4"
        r="3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M3.6 17c0-3.3 2.9-5.4 6.4-5.4s6.4 2.1 6.4 5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
