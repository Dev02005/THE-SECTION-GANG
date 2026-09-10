import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "Corridor — automatic block planning for Indian Railways";

/**
 * The card a shared link renders as.
 *
 * It carries the measured result rather than a slogan, read from the same
 * artefact the site loads - so it can never drift from what the page says.
 */
export default async function Image() {
  const file = path.join(process.cwd(), "public", "data", "plan.json");
  const plan = JSON.parse(await readFile(file, "utf-8"));
  const b = plan.kpis.baseline;
  const o = plan.kpis.optimised;

  const stats: [string, string][] = [
    ["Blocks", `${b.blocks} → ${o.blocks}`],
    ["Packing", `${b.packing} → ${o.packing}`],
    ["Clubbed", `${o.multidept_pct}%`],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f7f6f3",
          padding: "64px 72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 22,
              letterSpacing: 3,
              color: "#6b7480",
              textTransform: "uppercase",
            }}
          >
            SIH26027 · Ministry of Railways
          </div>
          <div
            style={{
              fontSize: 82,
              fontWeight: 700,
              color: "#1a1d21",
              lineHeight: 1.02,
              marginTop: 22,
              letterSpacing: -2,
            }}
          >
            Every block is a purchase.
          </div>
          <div
            style={{
              fontSize: 30,
              color: "#4a535e",
              marginTop: 24,
              maxWidth: 900,
              lineHeight: 1.35,
            }}
          >
            Joint maintenance block planning across three departments, priced in
            detention-minute equivalents.
          </div>
        </div>

        <div style={{ display: "flex", gap: 56, alignItems: "flex-end" }}>
          {stats.map(([k, v]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  fontSize: 20,
                  letterSpacing: 2,
                  color: "#6b7480",
                  textTransform: "uppercase",
                }}
              >
                {k}
              </div>
              <div style={{ fontSize: 46, fontWeight: 700, color: "#1f4e5f" }}>
                {v}
              </div>
            </div>
          ))}
          <div
            style={{
              marginLeft: "auto",
              fontSize: 20,
              color: "#6b7480",
            }}
          >
            Synthetic data · declared
          </div>
        </div>
      </div>
    ),
    size,
  );
}
