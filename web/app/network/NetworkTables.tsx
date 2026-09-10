import type { Station, StationData, PremiumData } from "@/lib/stations";
import { DocSection } from "@/components/DocSection";
import { TOTAL_DIVISIONS, TOTAL_ZONES, ZONES } from "@/lib/railways";

interface Props {
  chain: { station: Station; km: number }[];
  data: StationData;
  mapped: number;
  paths: NonNullable<
    import("@/lib/plan").PlanPayload["protectedPaths"]
  >;
  vb: PremiumData | null;
}

/**
 * The three evidence tables on /network.
 *
 * Split out of the page because it had grown to 418 lines, past the ~300 the
 * project holds itself to. The page keeps the argument; this keeps the tables
 * that support it.
 */
export function NetworkTables({ chain, data, mapped, paths, vb }: Props) {
  return (
    <>
        <DocSection title="Our corridor, checked against the national dataset">
          <p>
            The reference corridor was named from railway knowledge before we
            held any real data, so it was entirely possible to have invented a
            station that does not exist.{" "}
            <strong className="text-ink">All five resolve</strong> — codes,
            names and coordinates below are from the CC0 dataset, and the
            chainages are computed from those coordinates rather than asserted.
          </p>
          <div className="my-3 overflow-x-auto rounded-lg border border-rule bg-surface">
            <table className="w-full min-w-[460px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-rule">
                  {["Chainage", "Code", "Station", "Coordinates"].map((h, i) => (
                    <th
                      key={h}
                      className={`px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-mut ${
                        i === 0 ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chain.map(({ station, km }) => (
                  <tr key={station.c} className="border-b border-rule-soft last:border-0">
                    <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                      {km.toFixed(1)} km
                    </td>
                    <td className="px-3 py-2 font-mono text-ink">{station.c}</td>
                    <td className="px-3 py-2 text-ink-mid">{station.n}</td>
                    <td className="tnum px-3 py-2 font-mono text-[12px] text-ink-mut">
                      {station.lat.toFixed(4)}, {station.lon.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-ink-mut">
            Chainage is the cumulative sum of straight-line hops between
            consecutive stops, so it under-reads the rail path slightly — the
            track curves where the great-circle does not. We report what was
            computed rather than applying a route factor we would have had to
            invent. <strong className="text-ink">These are the figures the
            engine now plans against</strong>: the section boundaries are
            derived from these coordinates, not written by hand. The corridor
            was previously modelled as 78 km, which was both invented and
            wrong.
          </p>
        </DocSection>

        <DocSection title="Stations by zone">
          <p>
            {mapped.toLocaleString()} of {data.stations.toLocaleString()}{" "}
            stations carry a zone. The CC0 source assigns one to under half of
            them, so the rest are merged from the Ministry station list — the
            two agree on 99% of the overlap, which is why the merge is
            trustworthy enough to do at all. What remains unassigned is mostly
            sidings and private yards, which belong to no division.
          </p>
          <div className="my-3 overflow-x-auto rounded-lg border border-rule bg-surface">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-rule">
                  {["Zone", "Headquarters", "Est.", "Divisions", "Stations"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-mut ${
                          i > 1 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {ZONES.map((z) => {
                  const ours = z.code === "ECoR";
                  return (
                    <tr
                      key={z.code}
                      className={`border-b border-rule-soft last:border-0 ${
                        ours ? "bg-accent-soft" : ""
                      }`}
                    >
                      <td className="px-3 py-2 text-ink">
                        <span className="font-mono text-[12px] text-ink-mid">
                          {z.code}
                        </span>{" "}
                        {z.name}
                        {ours && (
                          <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                            ours
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink-mid">{z.hq}</td>
                      <td className="tnum px-3 py-2 text-right font-mono text-ink-mut">
                        {z.year}
                      </td>
                      <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                        {z.divisions.length}
                      </td>
                      <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                        {(data.zoneCounts[z.code] ?? 0).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DocSection>

        <DocSection title="Protected paths, measured">
          <p>
            A block is never drawn across a premium service. Those paths used to
            be invented — two a day at 07:00 and 16:00, protecting nothing that
            runs. These are the real ones, taken from the same timetable and
            carried in the plan artefact rather than transcribed here.
          </p>
          {paths.length > 0 && (
            <div className="my-3 overflow-x-auto rounded-lg border border-rule bg-surface">
              <table className="w-full min-w-[520px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-rule">
                    {["Train", "Service", "Transit", "Runs"].map((h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-mut ${
                          i === 3 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paths.map((p) => {
                    const night = p.from >= "01:00" && p.from < "05:00";
                    return (
                      <tr
                        key={p.train}
                        className={`border-b border-rule-soft last:border-0 ${
                          night ? "bg-caution-soft" : ""
                        }`}
                      >
                        <td className="px-3 py-2 font-mono text-ink">{p.train}</td>
                        <td className="px-3 py-2 text-ink-mid">{p.name}</td>
                        <td className="tnum px-3 py-2 font-mono text-ink-mid">
                          {p.from}–{p.to}
                          {p.wrapsMidnight && (
                            <span className="ml-1.5 text-[11px] text-ink-mut">
                              next day
                            </span>
                          )}
                          {night && (
                            <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wider text-caution">
                              crosses night corridor
                            </span>
                          )}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mut">
                          {p.daysPerWeek}/wk
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p>
            The highlighted row is why this mattered.{" "}
            <strong className="text-ink">
              The Yesvantpur Duronto crosses the 01:00–05:00 night maintenance
              corridor at 03:30
            </strong>
            , and the invented pair missed it completely. The night window is
            now clipped to end at 03:30 rather than running to 05:00 — which is
            what a division would actually do: take the block, clear before the
            train.
          </p>
        </DocSection>

        {vb !== null && (
          <DocSection title="What we know exists but cannot protect">
            <p>
              {vb.services} Vande Bharat services run nationally, two of them on
              East Coast Railway — including{" "}
              <strong className="text-ink">Bhubaneswar–Visakhapatnam</strong>,
              which uses this line.
            </p>
            <p>
              <strong className="text-ink">
                They are not in the protected list above.
              </strong>{" "}
              The timetable we hold predates them — no Vande Bharat appears in
              it at all — so we know the service exists without knowing its path
              through our sections. Supplying a plausible timing would put an
              invented number back into the one place we have just finished
              removing them from, so the gap is declared instead.
            </p>
            <div className="my-3 overflow-x-auto rounded-lg border border-rule bg-surface">
              <table className="w-full min-w-[520px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-rule">
                    {["Zone", "Service", "Distance", "Time", "Max"].map((h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-mut ${
                          i > 1 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vb.rows
                    .filter((r) => r.zone === "ECoR" || /Visakh/i.test(r.service))
                    .map((r) => (
                      <tr
                        key={r.service}
                        className="border-b border-rule-soft last:border-0"
                      >
                        <td className="px-3 py-2 font-mono text-[12px] text-ink-mid">
                          {r.zone}
                        </td>
                        <td className="px-3 py-2 text-ink">{r.service}</td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                          {r.km ?? "—"} km
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mid">
                          {r.time ?? "—"}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-mono text-ink-mut">
                          {r.maxKmh ?? "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </DocSection>
        )}

    </>
  );
}

