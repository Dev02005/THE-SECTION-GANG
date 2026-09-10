"use client";

/** Hidden when printing — it is not part of the document. */
export function PrintButton() {
  return (
    <div className="mb-6 flex items-center gap-3 print:hidden">
      <button
        onClick={() => window.print()}
        className="rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink transition-opacity hover:opacity-90"
      >
        Print / save as PDF
      </button>
      <a
        href="/planner"
        className="text-[13px] text-ink-mid underline underline-offset-2 hover:text-ink"
      >
        back to the planner
      </a>
    </div>
  );
}
