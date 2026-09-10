/**
 * The two presentational pieces particular to the limits page.
 *
 * A two-column honest/invented split and a small stat: the shape of that
 * document rather than logic, extracted so the page stays under the 300-line
 * standard and so the prose is easier to find.
 *
 * The numbered section that used to live here is now `components/DocSection`,
 * shared with method, scale and network - it was written five times.
 */

export function Split({
  left,
  right,
}: {
  left: { h: string; items: string[] };
  right: { h: string; items: string[] };
}) {
  return (
    <div className="my-3 grid gap-5 sm:grid-cols-2">
      {[left, right].map((c, i) => (
        <div key={c.h}>
          <p
            className={`eyebrow mb-2 ${i === 0 ? "text-go" : "text-caution"}`}
          >
            {c.h}
          </p>
          <ul className="flex flex-col gap-1.5">
            {c.items.map((t) => (
              <li key={t} className="text-[13.5px] leading-snug">
                {t}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function Stat({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div className="rounded-lg border border-rule bg-surface p-3">
      <dt className="eyebrow mb-1">{k}</dt>
      <dd className="font-display text-[24px] font-bold leading-none text-ink">
        {v}
      </dd>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-mut">{note}</p>
    </div>
  );
}
