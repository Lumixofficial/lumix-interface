function StellarMark() {
  return (
    <svg
      aria-hidden="true"
      className="app-footer-stellar-mark"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

function XMark() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.24 2h3.31l-7.23 8.26L22.86 22h-6.66l-5.22-6.82L4.99 22H1.68l7.73-8.83L1.14 2h6.83l4.72 6.24L18.24 2Zm-1.16 18h1.83L7.01 3.9H5.05L17.08 20Z" />
    </svg>
  );
}

function DiscordMark() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.9a13.7 13.7 0 0 0-.63 1.28 18.3 18.3 0 0 0-5.49 0A12.6 12.6 0 0 0 8.65 2.9a19.7 19.7 0 0 0-4.93 1.47C.58 9.04-.27 13.58.15 18.06a19.9 19.9 0 0 0 6.04 3.05c.49-.66.92-1.36 1.29-2.1a12.9 12.9 0 0 1-2.03-.97c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.12 0c.16.14.33.26.5.38-.65.38-1.33.71-2.04.98.37.73.8 1.43 1.29 2.09a19.8 19.8 0 0 0 6.05-3.05c.5-5.19-.85-9.69-3.64-13.69ZM8.02 15.33c-1.18 0-2.15-1.09-2.15-2.42 0-1.34.95-2.43 2.15-2.43 1.2 0 2.17 1.1 2.15 2.43 0 1.33-.95 2.42-2.15 2.42Zm7.96 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.34.95-2.43 2.15-2.43 1.2 0 2.17 1.1 2.15 2.43 0 1.33-.94 2.42-2.15 2.42Z" />
    </svg>
  );
}

const socialLinks = [
  { label: "GitHub", icon: <GitHubMark />, href: "https://github.com/Lumixofficial", external: true },
  { label: "X", icon: <XMark />, href: "#", external: false },
  { label: "Discord", icon: <DiscordMark />, href: "#", external: false },
] as const;

const footerLinks: { label: string; href: string; external?: boolean }[] = [
  { label: "Terms", href: "#" },
  { label: "Privacy", href: "#" },
  { label: "Docs / How it works", href: "https://docs.lumixmarket.com/", external: true },
];

export function AppFooter() {
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div className="app-footer-row app-footer-primary">
          <span className="app-footer-built">
            <StellarMark />
            Built on Stellar
          </span>

          <nav className="app-footer-socials" aria-label="Lumix social links">
            {socialLinks.map((link) => (
              <a
                className="app-footer-social"
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                aria-label={link.label}
                title={link.label}
                key={link.label}
              >
                {link.icon}
              </a>
            ))}
          </nav>
        </div>

        <div className="app-footer-row app-footer-secondary">
          <nav className="app-footer-links" aria-label="Legal and documentation links">
            {footerLinks.map((link) => (
              <a
                className="app-footer-link"
                href={link.href}
                key={link.label}
                {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <span className="app-footer-copyright">{"\u00A9"} 2026 Lumix</span>
        </div>

        <p className="app-footer-risk">
          Trading digital assets and derivatives involves risk and may result in loss of funds. Nothing on Lumix is financial
          advice. Availability may be restricted by jurisdiction.
        </p>
      </div>
    </footer>
  );
}
