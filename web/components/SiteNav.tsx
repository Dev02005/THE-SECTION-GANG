"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";

/**
 * The nav, which only exists once an officer is signed in.
 *
 * THIS DIVISION'S WORK and nothing else: the plan on screen, the plan on
 * paper, and the record of what has been done to it. Everything that explains
 * the system rather than showing a plan lives under Docs inside the account
 * menu - one menu in the header, not two side by side.
 *
 * The audit log earns its place out here rather than under Docs because it is
 * not documentation: it is this zone's own record, it changes when an officer
 * acts, and "who approved this" is an operational question, not a question
 * about how the optimiser works.
 */
const WORK = [
  { href: "/planner", label: "Planner" },
  { href: "/plan", label: "Block plan" },
  { href: "/audit", label: "Audit" },
];

export function SiteNav() {
  const { session, ready } = useSession();

  //  Reserve nothing before hydration - the header simply has no nav until we
  //  know who this is, which keeps every page statically renderable.
  if (!ready || session === null) return null;

  return (
    <nav
      aria-label="Sections"
      className="order-last flex w-full flex-wrap items-center gap-1 sm:order-none sm:ml-4 sm:w-auto"
    >
      {WORK.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded px-2.5 py-1.5 text-[13px] text-ink-mid transition-colors hover:bg-surface-sunk hover:text-ink"
        >
          {l.label}
        </Link>
      ))}

    </nav>
  );
}
