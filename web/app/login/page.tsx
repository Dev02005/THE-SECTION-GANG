import { ProvenanceBanner } from "@/components/ProvenanceBanner";
import { SiteHeader } from "@/components/SiteHeader";
import { loadPlan } from "@/lib/loadPlan";
import { TOTAL_DIVISIONS, TOTAL_ZONES } from "@/lib/railways";
import { ROLES } from "@/lib/roles";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-static";

export const metadata = {
  title: "Sign in",
  description:
    "Demonstration sign-in across all 17 Indian Railways zones and 68 " +
    "divisions: which posts hold an account, at which level, and what each sees.",
};

/**
 * The way in. Every other page is behind it.
 *
 * The guard is real - `RequireSignIn` sends an anonymous visitor here from any
 * operational page, and the nav does not render until a post is chosen. The
 * SECURITY is not, and the page says so in its own copy: there is no server in
 * this deployment, so the check runs in the browser and the static plan file
 * remains fetchable directly. A gate that shapes the interface is worth
 * having; calling it access control would not be true.
 *
 * The guard runs after hydration precisely so that every route stays
 * statically rendered - the performance and SEO standards depend on it, and a
 * server that knew who you were is exactly the thing this deployment lacks.
 */
export default async function LoginPage() {
  const plan = await loadPlan();

  return (
    <>
      <SiteHeader />
      <ProvenanceBanner provenance={plan.provenance} />

      <main className="justified mx-auto w-full max-w-[980px] flex-1 px-6 pb-14">
        {/*  Graph paper behind the way in, the same ground the planner and the
             printed block plan are drawn on.  */}
        <section className="pb-1 pt-12">
          <p className="eyebrow mb-3">
            {TOTAL_ZONES} zones · {TOTAL_DIVISIONS} divisions · {ROLES.length} posts
          </p>
          <h1 className="text-[clamp(2rem,4.5vw,2.9rem)] font-bold leading-[1.05]">
            Sign in
          </h1>
          <p className="mt-5 max-w-[86ch] text-[16.5px] leading-relaxed text-ink-mid">
            Accounts here are posts, not people: five to a division — Sr.DEN,
            Sr.DSTE, Sr.DEE, Sr.DOM and the DRM — and five to a zone. Choose a
            zone and a division to see the posts that hold an account, then sign
            in as one.
          </p>
        </section>

        <div className="mt-7 rounded-lg border border-caution bg-caution-soft p-4">
          <p className="text-[13.5px] leading-relaxed text-ink">
            <strong>A demonstration directory, not RailNet.</strong> The{" "}
            {TOTAL_ZONES} zones and {TOTAL_DIVISIONS} divisions are the
            Ministry&rsquo;s published list; the posts on them are generated,
            and their passwords are printed on this page. A real deployment
            would carry no user table at all — every officer already has an{" "}
            <strong>HRMS employee ID</strong>, and a block plan is an auditable
            document, so &ldquo;approved by Sr.DEN&rdquo; has to resolve to an
            establishment record rather than a row in our database.
          </p>
        </div>

        <LoginForm />

        <section className="mt-9 border-t border-rule pt-6">
          <h2 className="mb-3 text-[22px] font-bold">What your post can see</h2>
          <div className="flex max-w-[74ch] flex-col gap-3 text-[15px] leading-relaxed text-ink-mid">
            <p>
              The credential is checked in the database, and so is everything
              you read after it. A divisional post sees its own
              division&rsquo;s plan; a zonal post sees the plans of its own
              zone; an officer of any other zone gets{" "}
              <strong className="text-ink">nothing at all</strong> — not a copy
              of someone else&rsquo;s plan relabelled with their division.
            </p>
            <p>
              That scope is applied inside the query rather than in the browser,
              so it is not something this page can be edited to opt out of. It
              is also why most posts here show an empty planner: only one
              division has been solved, and saying so is the point.
            </p>
          </div>
        </section>

      </main>
    </>
  );
}
