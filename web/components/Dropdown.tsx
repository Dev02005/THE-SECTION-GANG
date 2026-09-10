"use client";

import { type FocusEvent, type ReactNode, useEffect, useRef, useState } from "react";

/**
 * A header dropdown: a trigger, and a panel that closes when it should.
 *
 * Written once because two of them sit next to each other, and a pair of
 * menus that dismiss differently is worse than either on its own.
 *
 * Closing is the part that is easy to get wrong, so all four routes are here:
 * Escape, a click anywhere outside, focus leaving the group entirely, and a
 * click on any link inside (a menu that stays open over the page you just
 * navigated to is a bug people notice immediately).
 *
 * The blur handler checks `relatedTarget` rather than closing on any blur: a
 * user tabbing from the trigger INTO the panel would otherwise close the thing
 * they were tabbing into. That check is what keeps keyboard use working.
 */
export function Dropdown({
  label,
  trigger,
  align = "right",
  width = "w-[280px]",
  children,
}: {
  /** Names the panel for screen readers, and the button when it has no text. */
  label: string;
  trigger: ReactNode;
  align?: "left" | "right";
  width?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        //  Send focus back where it came from, or it lands on <body> and the
        //  next Tab starts from the top of the page.
        root.current?.querySelector("button")?.focus();
      }
    };
    const onOutside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    //  BOTH events, and the second is not redundant. Activating a button from
    //  the keyboard fires `click` with no `mousedown` at all, so listening only
    //  for mousedown left this menu open when the user tabbed to the next one
    //  and pressed Enter - two panels over each other. Measured, not guessed.
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("click", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("click", onOutside);
    };
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(e: FocusEvent<HTMLDivElement>) => {
        //  React's onBlur bubbles (the native one does not), so this fires for
        //  anything inside the group losing focus - which is exactly the event
        //  worth acting on, provided focus went somewhere outside.
        if (!root.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded border border-rule px-2 py-1 text-ink-mid transition-colors hover:border-ink-mut hover:text-ink"
      >
        {trigger}
        <Chevron open={open} />
      </button>

      {open && (
        <div
          aria-label={label}
          onClick={(e) => {
            //  Any link inside navigates, so the panel has done its job.
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
          className={`absolute z-30 mt-1.5 ${width} ${
            align === "right" ? "right-0" : "left-0"
          } max-h-[calc(100vh-72px)] overflow-y-auto overscroll-contain rounded-lg border border-rule bg-surface p-3 shadow-lg`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 10 6"
      aria-hidden="true"
      className={`h-[6px] w-[10px] shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
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
  );
}
