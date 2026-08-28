export const PRIVACY_POLICY_PATH = "/privacy";

const LAST_UPDATED = "August 28, 2026";

const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "public, max-age=3600",
  "content-language": "en",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

export function privacyPolicyResponse(
  method: "GET" | "HEAD",
  serviceOrigin: string,
): Response {
  return new Response(
    method === "HEAD" ? null : privacyPolicyHtml(serviceOrigin),
    {
      status: 200,
      headers: RESPONSE_HEADERS,
    },
  );
}

function privacyPolicyHtml(serviceOrigin: string): string {
  const canonicalUrl = escapeHtml(
    new URL(PRIVACY_POLICY_PATH, `${serviceOrigin}/`).href,
  );
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Privacy policy for the Hyper Trader mobile app.">
    <meta name="theme-color" content="#071511">
    <link rel="canonical" href="${canonicalUrl}">
    <title>Privacy Policy | Hyper Trader</title>
    <style>
      :root {
        color-scheme: dark;
        --background: #071511;
        --panel: #0d201b;
        --panel-raised: #122a24;
        --line: #244139;
        --text: #edf7f3;
        --muted: #aac1b9;
        --accent: #22c988;
        --link: #70b8ff;
      }

      * { box-sizing: border-box; }

      html { scroll-behavior: smooth; }

      body {
        margin: 0;
        background:
          radial-gradient(circle at 82% 4%, rgba(34, 201, 136, 0.12), transparent 28rem),
          var(--background);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.7;
      }

      a {
        color: var(--link);
        text-underline-offset: 0.2em;
      }

      a:hover { color: var(--text); }

      a:focus-visible {
        border-radius: 0.2rem;
        outline: 3px solid var(--accent);
        outline-offset: 3px;
      }

      .shell {
        width: min(100% - 2rem, 72rem);
        margin-inline: auto;
      }

      header {
        padding: clamp(3.5rem, 9vw, 7rem) 0 3rem;
        border-bottom: 1px solid var(--line);
      }

      .eyebrow,
      .meta,
      .boundary-label {
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .eyebrow {
        margin: 0 0 1rem;
        color: var(--accent);
        font-size: 0.78rem;
        font-weight: 700;
      }

      h1 {
        max-width: 13ch;
        margin: 0;
        font-size: clamp(3rem, 9vw, 6.8rem);
        font-weight: 760;
        letter-spacing: -0.065em;
        line-height: 0.92;
      }

      .lede {
        max-width: 42rem;
        margin: 1.75rem 0 0;
        color: var(--muted);
        font-size: clamp(1.08rem, 2.4vw, 1.35rem);
      }

      .lede strong { color: var(--text); }

      .meta {
        margin-top: 1.5rem;
        color: var(--muted);
        font-size: 0.73rem;
      }

      .boundary {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1px;
        margin-top: 2.5rem;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 1rem;
        background: var(--line);
      }

      .boundary-item {
        min-height: 8.5rem;
        padding: 1.25rem;
        background: rgba(13, 32, 27, 0.94);
      }

      .boundary-label {
        color: var(--accent);
        font-size: 0.68rem;
        font-weight: 700;
      }

      .boundary-item strong {
        display: block;
        margin-top: 0.65rem;
        line-height: 1.35;
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
        gap: clamp(2rem, 7vw, 6rem);
        padding: 3.5rem 0 6rem;
      }

      nav {
        position: sticky;
        top: 2rem;
        align-self: start;
      }

      nav p {
        margin: 0 0 0.75rem;
        color: var(--muted);
        font-size: 0.82rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      nav a {
        display: block;
        padding: 0.4rem 0;
        color: var(--muted);
        font-size: 0.92rem;
        text-decoration: none;
      }

      nav a:hover { color: var(--text); }

      article { min-width: 0; }

      section {
        padding: 0 0 2.75rem;
        scroll-margin-top: 2rem;
      }

      section + section {
        padding-top: 2.75rem;
        border-top: 1px solid var(--line);
      }

      h2 {
        margin: 0 0 1rem;
        font-size: clamp(1.45rem, 3vw, 2rem);
        letter-spacing: -0.025em;
        line-height: 1.2;
      }

      h3 {
        margin: 1.75rem 0 0.5rem;
        font-size: 1rem;
      }

      p, ul { margin: 0 0 1rem; }

      ul { padding-left: 1.2rem; }

      li { padding-left: 0.35rem; }

      li + li { margin-top: 0.65rem; }

      .note {
        margin-top: 1.25rem;
        padding: 1rem 1.1rem;
        border-left: 3px solid var(--accent);
        background: var(--panel);
        color: var(--muted);
      }

      .contact {
        padding: 1.4rem;
        border: 1px solid var(--line);
        border-radius: 1rem;
        background: var(--panel-raised);
      }

      .contact p:last-child { margin-bottom: 0; }

      footer {
        padding: 1.5rem 0 3rem;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 0.85rem;
      }

      @media (max-width: 46rem) {
        .boundary { grid-template-columns: 1fr; }
        .boundary-item { min-height: auto; }
        .layout { grid-template-columns: 1fr; }
        nav {
          position: static;
          padding-bottom: 1.5rem;
          border-bottom: 1px solid var(--line);
          columns: 2;
        }
        nav p { column-span: all; }
        nav a { break-inside: avoid; }
      }

      @media (prefers-reduced-motion: reduce) {
        html { scroll-behavior: auto; }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="shell">
        <p class="eyebrow">Hyper Trader / Legal</p>
        <h1>Privacy policy</h1>
        <p class="lede"><strong>Your keys stay with you.</strong> This policy explains the limited data Hyper Trader processes to show markets, submit confirmed actions, and deliver optional alerts.</p>
        <p class="meta">Last updated ${LAST_UPDATED}</p>
        <div class="boundary" aria-label="Privacy boundaries at a glance">
          <div class="boundary-item">
            <span class="boundary-label">On your device</span>
            <strong>API-wallet keys and biometric checks</strong>
          </div>
          <div class="boundary-item">
            <span class="boundary-label">Our service</span>
            <strong>Public account requests and optional alert settings</strong>
          </div>
          <div class="boundary-item">
            <span class="boundary-label">Never our business</span>
            <strong>Selling personal data or behavioral advertising</strong>
          </div>
        </div>
      </div>
    </header>

    <main class="shell layout">
      <nav aria-label="Privacy policy sections">
        <p>On this page</p>
        <a href="#scope">Scope</a>
        <a href="#data">Data we process</a>
        <a href="#device">Data on your device</a>
        <a href="#use">How we use data</a>
        <a href="#sharing">Service providers</a>
        <a href="#retention">Retention and deletion</a>
        <a href="#choices">Your choices</a>
        <a href="#contact">Contact</a>
      </nav>

      <article>
        <section id="scope">
          <h2>1. Scope and developer</h2>
          <p>This privacy policy applies to the Hyper Trader mobile application and its backend services. Hyper Trader is developed and maintained by Stonegate as an independent community project. Hyper Trader is not affiliated with or endorsed by Hyperliquid.</p>
          <p>Hyper Trader does not create a traditional username-and-password account. You may save public blockchain accounts on your device and optionally register an app installation for notifications.</p>
        </section>

        <section id="data">
          <h2>2. Data we process</h2>
          <h3>Public account and trading data</h3>
          <ul>
            <li>Public wallet or account addresses that you enter, scan, or select, plus the selected network.</li>
            <li>Public market, balance, position, order, fill, and account state retrieved from Hyperliquid for app features.</li>
            <li>Order details and other trading actions that you explicitly review and confirm. Confirmed actions are sent to Hyperliquid.</li>
          </ul>

          <h3>Optional notification data</h3>
          <p>If you enable notifications, the service may process a random installation identifier, a one-way hash of the installation credential, an encrypted Expo push token, alert rules, verified links to public accounts, event deduplication keys, and minimal delivery status.</p>

          <h3>Technical and support data</h3>
          <p>Hosting and security infrastructure may process your IP address and basic request metadata when your device connects. Hyper Trader does not embed advertising or third-party analytics SDKs. Diagnostic reports are created and shared only when you choose to export them.</p>
        </section>

        <section id="device">
          <h2>3. Sensitive data kept on your device</h2>
          <p>An API-wallet private key is stored in your device's protected operating-system storage. It is not sent to the Hyper Trader backend, support channels, analytics services, or notification service. Hyper Trader never asks for your master-wallet seed phrase or private key.</p>
          <p>Biometric or device-credential verification is performed by the operating system. Hyper Trader receives only the result needed to allow or deny access; it does not receive or store biometric data.</p>
          <p>If you use the QR scanner, camera frames are processed on your device to read a public wallet address. Hyper Trader does not upload or retain those images.</p>
        </section>

        <section id="use">
          <h2>4. How we use data</h2>
          <ul>
            <li>Provide market discovery, portfolio views, trading, account management, and user-requested support.</li>
            <li>Deliver optional price and account alerts and prevent duplicate notifications.</li>
            <li>Authenticate an app installation, verify account control for sensitive notification changes, prevent abuse, and protect service integrity.</li>
            <li>Maintain reliability and investigate failures using bounded operational records that exclude private keys and complete signed actions.</li>
          </ul>
          <p>We do not sell personal data, use it for behavioral advertising, or share it with data brokers.</p>
        </section>

        <section id="sharing">
          <h2>5. Services that process data</h2>
          <ul>
            <li><strong>Hyperliquid</strong> receives public-data requests and any trading action you confirm. Its own terms and privacy practices apply.</li>
            <li><strong>Expo</strong> processes the push token and a minimal, non-sensitive notification payload when notifications are enabled.</li>
            <li><strong>Cloudflare</strong> hosts the public backend and may process connection and security metadata. Portfolio request bodies are not durably stored by Hyper Trader.</li>
            <li><strong>jsDelivr</strong> may receive ordinary network request information when the app loads public market icon images.</li>
          </ul>
          <p>These providers process data only as needed to supply their respective service. Public blockchain activity remains publicly visible independently of Hyper Trader.</p>
        </section>

        <section id="retention">
          <h2>6. Data retention and deletion</h2>
          <ul>
            <li>Active notification installation data, encrypted push tokens, verified links, and alert rules are kept until the related installation is revoked or link is removed.</li>
            <li>Notification delivery records are kept for up to 30 days, event deduplication keys for up to 7 days, and consumed or expired verification challenges for up to 24 hours.</li>
            <li>Raw data evaluated for alerts and complete provider payloads have no durable retention.</li>
            <li>Deletion tombstones use one-way identifiers and are retained long enough to prevent deleted data from being restored from an eligible backup.</li>
            <li>Portfolio request responses are marked not to be stored by caches and are not retained as raw account snapshots by the backend.</li>
          </ul>
          <p>You can delete price alerts in notification settings and remove saved accounts through the app. Removing an account deletes its protected local key after the app completes the relevant safety checks. To request deletion of remaining notification-service data when you cannot use the app, contact the maintainers using the channels below. Never send a seed phrase, private key, or installation credential.</p>
        </section>

        <section id="choices">
          <h2>7. Your choices and security</h2>
          <p>You can use public market features without enabling push notifications or camera access. Device settings let you withdraw those permissions. You can also remove saved accounts and locally stored app data.</p>
          <p>Hyper Trader uses HTTPS for network traffic, authenticated device storage for API-wallet keys, hashed installation credentials, encrypted push tokens, bounded access controls, and data-minimizing notification payloads. No security measure can eliminate every risk, and public blockchain transactions cannot be reversed or erased.</p>
          <div class="note">Hyper Trader is intended for adults who can legally use digital-asset trading services in their jurisdiction. We do not knowingly collect personal data from children under 18.</div>
        </section>

        <section id="contact">
          <h2>8. Changes and contact</h2>
          <p>We may update this policy when Hyper Trader's features or data practices change. The date at the top identifies the current version.</p>
          <div class="contact">
            <p><strong>Developer:</strong> Stonegate<br><strong>App:</strong> Hyper Trader</p>
            <p>For privacy questions or deletion requests, contact the maintainers through the <a href="https://github.com/stonega/hyper-trader" rel="noreferrer">Hyper Trader GitHub repository</a> or the <a href="https://t.me/+3okq17iiGak4NWFl" rel="noreferrer">Hyper Trader Telegram community</a>. Ask for a private channel before sharing any personal information.</p>
          </div>
        </section>
      </article>
    </main>

    <footer>
      <div class="shell">Hyper Trader · Independent, self-custodial trading interface</div>
    </footer>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
