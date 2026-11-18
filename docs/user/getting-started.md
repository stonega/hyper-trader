# Getting started

Hyper Trader is a native iOS and Android Hyperliquid client. The current
functional build enables network-isolated setup, device-side key protection,
signing, submission, and recovery on Hyperliquid testnet and mainnet. Mainnet
actions use real funds. Public builds pass the automated repository gate,
target-device smoke test, artifact-digest check, and release-owner decision
before store submission.

## First launch

Hyper Trader first explains why trading uses a dedicated API wallet. Choose
**Set up API wallet** to enter the protected setup flow, or **Skip for now** to
open Trade in read-only mode. Either choice closes first-use onboarding. You can
start or resume API-wallet setup later from Settings.

## What you can do

- Explore the validated runtime catalog, including native perpetuals, HIP-3
  perpetuals, spot pairs, and browse-only quarantined/outcome records.
- Search and filter Markets, select a market, and keep safe cached public data
  visible during stale, offline, reconnecting, and partial-source states.
- Use Trade to inspect current market data and submit supported actions after an
  exact signer, current account state, immutable review, and explicit
  confirmation.
- Inspect the Portfolio, account/security settings, appearance preferences, and
  redacted diagnostics without granting additional trading authority.

## Change the backend server

Open **Settings → Backend API**, enter an HTTPS server URL, and tap **Save backend**.
Review the destination and confirm **Use backend**. The app saves your selection
on this device and reloads data from that server. The server can see the public
account addresses used for Portfolio requests, so choose a server you trust.
Changing servers clears open order drafts and locks the trading session; finish
an active order before switching.

Tap **Use default** to restore `https://hyper-trader-backend.clawearn.xyz` in the
standard build. Existing installed versions need an updated build to gain this
setting.

## What is not enabled

The native Reown handoff and account-alert proof path are not active. Deposits,
withdrawals, and transfers are not implemented. A candidate can access an exact
authorized Mainnet key and fixed-origin `/exchange` transport after the user
configures a local API wallet. Controls explain missing authority and do not
simulate success.

## Safety

- Never enter a seed phrase or private key into a development build.
- Treat unexpected wallet prompts as unsafe.
- Confirm the network, asset, side, price, size, leverage, and slippage before
  approving any future order.
- Prefer testnet for the first authenticated pass; use the private mainnet
  candidate only when real-funds testing is intentional.
- A build or screen claiming approved mainnet signing without the matching
  release evidence, silent context switching, unsigned updates, or secret
  recovery is unsafe and should not be used.
