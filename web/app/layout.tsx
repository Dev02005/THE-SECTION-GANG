import type { Metadata } from "next";
import { DM_Mono, DM_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@/components/ThemeScript";

/*
  Three typefaces, each doing one job: Space Grotesk for headings, where its
  slightly technical geometry reads as signage rather than editorial; DM Sans
  for body; DM Mono for identifiers, times and anything with digits that must
  line up in a column.

  This replaced IBM Plex. Plex is a fine superfamily, but one family in three
  widths gave the page a uniform texture, and a block plan wants a clear
  hierarchy between a heading, a sentence and a train number.
*/
const display = Space_Grotesk({
  variable: "--font-display-src",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const sans = DM_Sans({
  variable: "--font-sans-src",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const mono = DM_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const SITE = "https://corridor-rail.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Corridor — Automatic Block Planning",
    template: "%s · Corridor",
  },
  description:
    "Joint maintenance block planning for Indian Railways. Prices asset risk " +
    "and train detention in one unit, then buys the most risk reduction per " +
    "minute of line occupation across Engineering, S&T and Traction.",
  keywords: [
    "Indian Railways",
    "maintenance block planning",
    "SIH26027",
    "constraint programming",
    "CP-SAT",
    "rail operations research",
  ],
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "Corridor",
    title: "Automatic Block Planning for Indian Railways",
    description:
      "Every maintenance block is a purchase: it spends line capacity and buys " +
      "risk reduction. We price both sides in the same unit.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Automatic Block Planning for Indian Railways",
    description:
      "Joint block planning across three departments, priced in detention-minute " +
      "equivalents.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
