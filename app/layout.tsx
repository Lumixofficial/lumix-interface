import type { Metadata } from "next";
import Script from "next/script";
import "@fontsource-variable/inter";
import "./globals.css";
import { AppProviders } from "../components/wallet-provider";

export const metadata: Metadata = {
  title: "Spot | Lumix",
  description: "Route spot trades across Stellar liquidity.",
};

const directionContract = `
THESIS: Make best execution inspectable without turning a focused swap into a crowded terminal.
OWN-WORLD: Lumix's dark-default, theme-adaptive Poly Blue and Pure Gray system, compact raised controls, quiet borders, Inter labels, and tabular mono financial values.
STORY: Choose assets and size, inspect route quality and prerequisites, review intent, then follow the wallet-to-ledger lifecycle.
FIRST VIEWPORT: A compact shell frames one centered two-column workspace; the wider swap ticket leads on the left, route evidence sits beside it, and the commit closes the ticket.
FORM: Established-world extension, first-ranked execution receipt structure; seed key established-world/direct-brief.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
`;

const themeInitScript = `(function(){var t="dark";try{var s=localStorage.getItem("lumix-theme");if(s==="light"||s==="dark")t=s}catch(e){}document.documentElement.setAttribute("data-theme",t)})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <span hidden dangerouslySetInnerHTML={{ __html: `<!--${directionContract}-->` }} />
        <AppProviders>{children}</AppProviders>
        <Script async src="https://www.googletagmanager.com/gtm.js?id=GTM-W7DXCBZ9" strategy="afterInteractive" />
        <Script id="google-tag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
          `}
        </Script>
      </body>
    </html>
  );
}
