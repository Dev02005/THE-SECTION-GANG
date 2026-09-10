import { ProvenanceBanner } from "@/components/ProvenanceBanner";
import { DocSection } from "@/components/DocSection";
import { RequireSignIn } from "@/components/RequireSignIn";
import { SiteHeader } from "@/components/SiteHeader";
import { loadPlan } from "@/lib/loadPlan";
import { TOTAL_DIVISIONS, TOTAL_ZONES, ZONES } from "@/lib/railways";
import { corridorChain, loadStations, loadVandeBharat } from "@/lib/stations";
import { NetworkTables } from "./NetworkTables";

export const dynamic = "force-static";

export const metadata = {
  title: "The network",
  description:
    "The real reference data behind Corridor: 8,697 Indian Railways stations, " +
    "17 zones and 68 divisions — and exactly where our solved plan sits in it.",
};

/**
 * What the system knows, against what it has solved.
 *
 * Two real datasets meet here: the Ministry list of zones and divisions, and
 * DataMeet's CC0 station master. Neither feeds the optimiser, and the page
 * says so twice, because a page of real data next to a plan computed from
 * generated data is exactly the impression we criticise other entrants for
 * leaving.
 *
 * The honest claim is narrow and worth making precisely: national in what it
 * knows, one division in what it has solved. That is also how the railway
 * works - a DRM plans a division, not a country.
 */
export default async function NetworkPage() {
  const [plan, data, vb] = await Promise.all([
    loadPlan(),
    loadStations(),
    loadVandeBharat(),
  ]);
  const paths = plan.protectedPaths ?? [];
  const chain = corridorChain(data);
  const mapped = Object.values(data.zoneCounts).reduce((a, b) => a + b, 0);
  const corridorKm = chain.length > 0 ? chain[chain.length - 1].km : 0;

  return (
    <>
      <SiteHeader />
      <ProvenanceBanner provenance={plan.provenance} />

      <RequireSignIn>
      <main className="mx-auto w-full max-w-[980px] flex-1 px-6 pb-14">
        <section className="pb-1 pt-12">
          <p className="eyebrow mb-3">The network</p>
          <h1 className="text-[clamp(2rem,4.5vw,2.9rem)] font-bold leading-[1.05]">
            National in what it knows.
            <br />
            One division in what it has solved.
          </h1>
          <p className="mt-5 max-w-[86ch] text-[16.5px] leading-relaxed text-ink-mid">
            Two real, published datasets sit behind this application: the Ministry
            of Railways list of zones and divisions, and the DataMeet station
            master. Everything else — the maintenance backlog, the traffic shape,
            the defects — is generated and declared.
          </p>
        </section>

        <dl className="mt-8 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          <Stat value={data.stations.toLocaleString()} label="Stations" note="with coordinates" />
          <Stat value={String(TOTAL_ZONES)} label="Zones" note="Ministry list" />
          <Stat value={String(TOTAL_DIVISIONS)} label="Divisions" note="across those zones" />
          <Stat value="1" label="Divisions solved" note="Waltair, ECoR" />
        </dl>

        <div className="mt-6 rounded-lg border border-caution bg-caution-soft p-4">
          <p className="text-[13.5px] leading-relaxed text-ink">
            <strong>Two halves, and they are used differently.</strong> The{" "}
            {data.stations.toLocaleString()}-station master is reference only — it names zones, divisions
            and stations, and it is how the sign-in knows which post belongs
            where. It never reaches the optimiser. The five stations of our own
            corridor <em>do</em>: their coordinates now derive the section
            boundaries the engine plans against, replacing the invented figures
            that were there before. So the geometry is real and the maintenance
            backlog is still generated — and it is worth separating those
            plainly rather than letting a page of real data imply more than it
            should.
          </p>
        </div>

        <NetworkTables
          chain={chain}
          data={data}
          mapped={mapped}
          paths={paths}
          vb={vb}
        />
        <DocSection title="Why we do not solve the country">
          <p>
            Because we measured what happens if we try, and published it. The{" "}
            <a className="underline underline-offset-2 hover:text-ink" href="/scale">
              scale page
            </a>{" "}
            shows the optimiser feasible to about a thousand tasks across twenty
            sections and returning <strong className="text-ink">UNKNOWN</strong>{" "}
            at forty. A national solve is not a bigger version of this problem;
            it is a different one.
          </p>
          <p>
            It is also not the job. A division schedules — which four hours on
            Thursday, at fifteen-minute resolution. A zone allocates — which
            division holds the tamper this season. Planning {corridorKm.toFixed(0)}{" "}
            km properly and saying so beats claiming {data.stations.toLocaleString()}{" "}
            stations we cannot place a block on.
          </p>
        </DocSection>

        <DocSection title="Provenance">
          <p>
            Station master: <strong className="text-ink">{data.source}</strong>,
            retrieved {data.retrieved} —{" "}
            <a
              className="underline underline-offset-2 hover:text-ink"
              href={data.url}
              rel="noreferrer"
            >
              {data.url}
            </a>
            . Zones and divisions: Ministry of Railways,{" "}
            <em>List of Zones &amp; Divisions</em>. Both are public and cited,
            which is the part that matters — a dataset whose origin cannot be
            named is worth less than a smaller one that can.
          </p>
        </DocSection>
      </main>
      </RequireSignIn>
    </>
  );
}

function Stat({
  value,
  label,
  note,
}: {
  value: string;
  label: string;
  note: string;
}) {
  return (
    <div>
      <dd className="tnum font-display text-[28px] font-bold leading-none text-ink">
        {value}
      </dd>
      <dt className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-mut">
        {label}
      </dt>
      <dd className="mt-0.5 text-[11.5px] leading-tight text-ink-mid">{note}</dd>
    </div>
  );
}

