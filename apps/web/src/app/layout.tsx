import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Mono, Libre_Caslon_Text, Source_Sans_3 } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ToastProvider } from "@/components/Toast";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { getCurrentUser, serverApi } from "@/lib/session";
import "@/styles/globals.css";

const display = Libre_Caslon_Text({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--font-display", display: "swap" });
const body = Source_Sans_3({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-body", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_ORIGIN ?? "http://localhost:3000"),
  title: { default: "Redart — a reading ledger for engineers", template: "%s · Redart" },
  description: "Plan your reading, tick off articles, keep a note on each. Redart checks every link and estimates its read time.",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], apple: "/icon-192.png" },
  openGraph: {
    type: "website",
    title: "Redart — a reading ledger for engineers",
    description: "Plan your reading, tick off articles, keep a note on each. Every link checked, every read time estimated.",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1d3557" },
    { media: "(prefers-color-scheme: dark)", color: "#111a26" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const member = await getCurrentUser();
  const unread = member ? (await serverApi<{ count: number }>("/api/notifications/unread-count")).data?.count ?? 0 : 0;
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <ToastProvider>
          <div className="wrap">
            <SiteHeader member={member} unread={unread} />
            <main className="wrap page" id="main">{children}</main>
            <SiteFooter />
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
