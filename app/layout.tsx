import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Libre_Caslon_Text, Public_Sans } from "next/font/google";
import "./globals.css";

const caslon = Libre_Caslon_Text({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-caslon",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Legal Information Navigator",
  description:
    "Understand a contract before you sign it: plain-English summaries, risky clauses, cited answers and questions for your attorney. Informational only, not legal advice.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1322" },
  ],
};

// Runs before paint so the saved theme never flashes the wrong colours.
const themeScript = `(function(){try{var t=localStorage.getItem('lin-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${caslon.variable} ${publicSans.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a
          href="#workspace"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-action focus:px-4 focus:py-2 focus:text-action-ink"
        >
          Skip to workspace
        </a>
        {children}
      </body>
    </html>
  );
}
