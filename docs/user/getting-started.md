# Getting started

Hyper Trader is a native iOS and Android Hyperliquid client. The current reviewed
build supports complete read-only exploration and testnet-safe draft/review
surfaces. Live external-wallet authorization and exchange submission remain
closed until the security and physical-device release gates are approved.

## What you can do

- Explore the validated runtime catalog, including native perpetuals, HIP-3
  perpetuals, spot pairs, and browse-only quarantined/outcome records.
- Search and filter Markets, select a market, and keep safe cached public data
  visible during stale, offline, reconnecting, and partial-source states.
- Use Trade to inspect current market data and the order controls that apply to
  the selected market. Review remains gated without an exact testnet signer and
  current account state.
- Inspect the Portfolio, account/security settings, redacted diagnostics, and
  notification setup without granting trading authority.

## What is not enabled

The native Reown handoff, physical-device signer approval, live testnet exchange
transport, and account-alert proof path are not active in the current release
gate. Deposits, withdrawals, transfers, and every mainnet action are out of
scope. Disabled controls explain the missing authority and do not simulate
success.

## Safety

- Never enter a seed phrase or private key into a development build.
- Treat unexpected wallet prompts as unsafe.
- Confirm the network, asset, side, price, size, leverage, and slippage before
  approving any future order.
- Use testnet when authenticated trading development begins.
- Treat push alerts as informational. Opened alerts fetch current state and ask
  before changing account or network.
- A build or screen claiming mainnet signing, silent context switching, unsigned
  updates, or secret recovery is unsafe and should not be used.
