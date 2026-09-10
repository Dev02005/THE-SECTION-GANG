import type { ReactNode } from "react";

/**
 * A numbered section of a document page.
 *
 * There were FIVE copies of this - limits, method, scale, network and the
 * network tables - four of them byte-identical and the fifth spaced
 * differently (`mt-12 pt-7` against everyone else's `mt-9 pt-6`), left behind
 * when the section rhythm changed. So the duplication was not merely wasteful:
 * one page had quietly stopped matching the others.
 *
 * `n` is optional because two of those pages number their sections and two do
 * not. That is the only difference between them, and it is a prop rather than
 * a second component.
 */
export function DocSection({
  n,
  title,
  children,
}: {
  /** "01", "02"… Omitted where a page does not number its sections. */
  n?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-9 border-t border-rule pt-6">
      {n !== undefined && <p className="eyebrow mb-2">{n}</p>}
      <h2 className="mb-3 text-[22px] font-bold">{title}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-ink-mid [&_strong]:text-ink">
        {children}
      </div>
    </section>
  );
}
