import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { api } from "@/lib/api";
import { ProtocolHeader } from "@/components/layout/ProtocolHeader";
import { Footer } from "@/components/layout/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://recourse.local"),
  title: {
    default: "Recourse — the programmable chargeback layer for autonomous commerce",
    template: "%s — Recourse",
  },
  description:
    "Payments got autonomous. Refunds didn't. Recourse gives autonomous purchases a programmable chargeback path — from machine-readable promises to evidence-backed adjudication and settlement.",
  openGraph: {
    title: "Recourse — the programmable chargeback layer for autonomous commerce",
    description:
      "Machine-readable promises, deterministic verification, GenLayer adjudication, programmable refunds.",
    type: "website",
  },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const networkStatus = await api.getNetworkStatus();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-fg">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:border focus:border-fg focus:bg-canvas focus:px-3 focus:py-2 focus:font-mono focus:text-xs focus:tracking-[0.14em] focus:uppercase"
        >
          Skip to content
        </a>
        <ProtocolHeader networkStatus={networkStatus} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
