import { AuditLog } from "@/components/AuditLog";
import { RequireSignIn } from "@/components/RequireSignIn";
import { SiteHeader } from "@/components/SiteHeader";

export const dynamic = "force-static";

export const metadata = {
  title: "Audit log",
  description:
    "Every change of state to a block plan, attributed to the post that made " +
    "it, in an append-only log the application can add to but not revise.",
};

/**
 * Who did what, and when.
 *
 * `audit_log` has been written to since the first migration - a submission, a
 * decision, a reset and a password change all land in it - and until now
 * nothing read it back. That is a gap worth closing for its own sake: a block
 * plan is an auditable document, and the first question asked of one is who
 * approved it.
 *
 * Static like every other route. The page ships empty and the entries arrive
 * in the browser under the signed-in officer's own credential, so the scope is
 * applied by Postgres rather than by this file.
 */
export default function AuditPage() {
  return (
    <>
      <SiteHeader />
      <RequireSignIn>
        <main className="mx-auto w-full max-w-[1000px] flex-1 px-4 py-8 sm:px-6">
          <AuditLog />
        </main>
      </RequireSignIn>
    </>
  );
}
