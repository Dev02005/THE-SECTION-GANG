import { DEPT_LABEL } from "@/lib/plan";

/** Colour is information here, so the key has to be present, not implied. */
export function Legend() {
  const swatches = [
    { c: "var(--engg)", l: DEPT_LABEL.ENGG },
    { c: "var(--snt)", l: DEPT_LABEL.SNT },
    { c: "var(--trd)", l: DEPT_LABEL.TRD },
    { c: "var(--clubbed)", l: "Clubbed (multi-department)" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-mid">
      {swatches.map((s) => (
        <span key={s.l} className="flex items-center gap-1.5">
          <i
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: s.c }}
          />
          {s.l}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <i
          aria-hidden
          className="inline-block h-2.5 w-8 rounded-[2px]"
          style={{
            background:
              "linear-gradient(90deg, rgba(220,38,38,0.05), rgba(220,38,38,0.55))",
          }}
        />
        Detention cost — darker is costlier to block
      </span>
    </div>
  );
}
