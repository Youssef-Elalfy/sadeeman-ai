import type { Metadata, Viewport } from "next";
import { Alexandria, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import "./celestial.css";
import "./shell.css";

// Self-hosted at build time by next/font: no runtime request to Google.
const body = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-ar",
});
// Brand display face (brand/brand.json) — headings and wordmark only.
const display = Alexandria({
  subsets: ["arabic", "latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-display",
});
export const metadata: Metadata = {
  title: "سَدِيمًا | SADEEMAN AI",
  description:
    "رحلتك أبعد من الخيال. Beyond Destinations. Beyond Expectations.",
};
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1d1425" },
    { media: "(prefers-color-scheme: light)", color: "#fff6ec" },
  ],
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${body.variable} ${display.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
