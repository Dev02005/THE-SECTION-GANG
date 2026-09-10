"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";

/**
 * The nav, which only exists once an officer is signed in.
 *
 * Two links, and only two: THIS DIVISION'S WORK - the plan on screen and the
 * plan on paper. Everything else explains the system rather than showing a
 * plan, and it lives under Docs inside the account menu rather than as a
 * second dropdown out here. One menu in the header, not two side by side.
 */
const WORK = [
  { href: "/planner", label: "Planner" },
  { href: "/plan", label: "Block plan" },
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
