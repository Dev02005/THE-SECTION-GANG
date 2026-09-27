"use client";

import { useEffect, useState } from "react";
import type { PlanPayload } from "@/lib/plan";
import { planFingerprint, shortFingerprint } from "@/lib/fingerprint";

/**
 * The plan's fingerprint, recomputed here from the plan actually on screen.
 *
 * Recomputed rather than displayed, on purpose. Showing the stored value would
 * only prove the database can repeat itself; hashing what is drawn and
 * comparing it with what was recorded proves the drawing is the recorded plan.
 *
 * `document` - for the printed plan: the full hash, no verdict, because paper
 * cannot check itself; it carries the value so someone later can.
 *
 * `panel` - on screen, beside the approval chain: the short form and the
 * comparison with the plan record. A mismatch is not softened. It means the
 * plan being shown is not the plan the record describes, and that is the one
 * thing this feature exists to make impossible to miss.
 */
export function PlanFingerprint({
  plan,
  stored,
  variant,
}: {
  plan: PlanPayload;
  /**
   * The value on the plan row. `undefined` = no record at all (offline);
   * `null` = a record carrying no fingerprint (seeded before 0011).
   */
  stored?: string | null;
  variant: "document" | "panel";
}) {
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    planFingerprint(plan).then((h) => {
      if (live) setHash(h);
    });
    return () => {
      live = false;
    };
  }, [plan]);

  if (variant === "document") {
    return (
      <>
        Fingerprint (SHA-256 of the blocks and tasks granted):{" "}
        <span className="break-all text-ink">{hash ?? "computing…"}</span>
      </>
    );
  }

  if (hash === null) {
    return (
      <p className="mb-4 font-mono text-[11px] text-ink-mut print:hidden">
        Computing fingerprint…
      </p>
    );
  }

  const short = shortFingerprint(hash);

  if (stored !== undefined && stored !== null && stored !== hash) {
    return (
      <p
        role="alert"
        className="mb-4 rounded border border-caution bg-caution-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink print:hidden"
      >
        <strong>This plan does not match its record.</strong> The plan shown
        hashes to <code className="font-mono">{short}</code>; the plan record
        carries <code className="font-mono">{shortFingerprint(stored)}</code>.
        What is drawn here is not the plan that was recorded, and should not be
        issued until the difference is explained.
      </p>
    );
  }

  return (
    <p className="mb-4 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-ink-mut print:hidden">
      <span className="uppercase tracking-[0.1em]">Fingerprint</span>
      <span className="text-ink">{short}</span>
      <span>
        {stored === undefined
          ? "· no database record to check it against"
          : stored === null
            ? "· the plan record carries no fingerprint yet"
            : "· matches the plan record"}
      </span>
    </p>
  );
}
