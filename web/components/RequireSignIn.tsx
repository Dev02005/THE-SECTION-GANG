"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";

/**
 * Route guard: an officer must be signed in to reach the operational pages.
 *
 * WHAT THIS IS NOT. There is no server in this deployment - every route is
 * prerendered and the plan travels as a static JSON file. A guard that runs in
 * the browser therefore controls the *interface*, not access to the data:
 * anyone who opens devtools, or requests /data/plan.json directly, still has
 * the artefact. Calling it security would be a claim the architecture cannot
 * support, and this file would rather say so than imply otherwise.
 *
 * Real access control needs the thing a real deployment already has: a server,
 * and HRMS on RailNet behind it. That is set out on the sign-in page and in
 * docs/LIMITATIONS.md.
 *
 * What the guard DOES buy is the right shape - the application behaves like an
 * internal system rather than a public dashboard, and every page below it is
 * entered as a named post rather than anonymously.
 *
 * The check runs after hydration on purpose. Every route stays statically
 * rendered, which is what the performance and SEO standards depend on, and the
 * server has no idea who the viewer is, so painting a signed-in view on the
 * first pass would be a hydration mismatch.
 */
export function RequireSignIn({ children }: { children: React.ReactNode }) {
  const { session, ready } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && session === null) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [ready, session, pathname, router]);

  //  Before hydration resolves we know nothing about the viewer. Hold the
  //  layout rather than flashing either state.
  if (!ready || session === null) {
    return (
      <main
        className="mx-auto flex w-full max-w-[980px] flex-1 items-center px-6 py-24"
        aria-busy={!ready}
      >
        <div className="signal-rule">
          <p className="eyebrow mb-2">Restricted</p>
          <p className="text-[15px] leading-relaxed text-ink-mid">
            {ready
              ? "This page is part of the divisional planning system. Taking you to sign in…"
              : "Checking your sign-in…"}
          </p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
