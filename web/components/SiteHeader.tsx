import Link from "next/link";
import { AccountMenu } from "./AccountMenu";
import { SiteNav } from "./SiteNav";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-surface/85 backdrop-blur">
      {/*
        Wraps rather than overflows. At 360px the nav drops to its own row
        instead of pushing the theme toggle off-screen, which is what happened
        when this was a single non-wrapping flex row.
      */}
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2.5">
          <span className="font-display text-[19px] font-bold tracking-tight text-ink">
            Corridor
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mut md:inline">
            Automatic block planning
          </span>
        </Link>

        {/*
          The nav lives in a client component because it only appears once an
          officer is signed in; the header itself stays a server component so
          every page remains statically rendered.
        */}
        <SiteNav />

        {/*
          The account sits LAST, hard right, after the nav. It was before the
          nav in the DOM and `ml-auto` pushed it into the middle of the row,
          which put the identity control where a section link belongs.

          One control, not two: the theme now lives inside this menu under
          Settings, because it is a preference of the person signed in - and a
          signed-out visitor gets the system setting and no control at all, so
          there was nothing for a second button in the header to do.
        */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
