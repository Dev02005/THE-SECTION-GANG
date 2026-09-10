"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";

type Theme = "light" | "dark" | "system";

const KEY = "corridor-theme";

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the choice just will not persist */
  }
}

const OPTIONS: { value: Theme; label: string; title: string }[] = [
  { value: "light", label: "Day", title: "Light theme" },
  { value: "system", label: "Auto", title: "Follow system setting" },
  { value: "dark", label: "Night", title: "Dark theme" },
];

/**
 * The theme control belongs to the signed-in officer, not to the public page.
 *
 * A visitor who has not signed in gets the system setting - whatever their
 * operating system already says about light or dark - and no control at all.
 * The reasoning is that this is an internal planning application with a public
 * front: appearance is a preference of the person using the tool, and there is
 * nobody to hold a preference for until a post is chosen.
 *
 * Signing out therefore also drops any stored choice, so the next visitor to
 * this browser starts from the system setting rather than inheriting one.
 */
export function ThemeToggle() {
  const { session, ready } = useSession();
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    if (!ready) return;
    if (session === null) {
      //  Nobody signed in: hand the page back to the operating system.
      apply("system");
      setTheme("system");
      return;
    }
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === "light" || stored === "dark") setTheme(stored);
    } catch {
      /* ignore */
    }
  }, [ready, session]);

  //  Render nothing before hydration too: the server cannot know who this is,
  //  so painting the control on the first pass would be a hydration mismatch.
  if (!ready || session === null) return null;

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex rounded-md border border-rule bg-surface-sunk p-0.5"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={theme === o.value}
          title={o.title}
          onClick={() => {
            setTheme(o.value);
            apply(o.value);
          }}
          className={`px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded transition-colors ${
            theme === o.value
              ? "bg-surface text-ink shadow-sm"
              : "text-ink-mut hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
