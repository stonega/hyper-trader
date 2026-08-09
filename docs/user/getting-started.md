# Using the starter app

Hyper Trader currently provides a read-only market dashboard.

## What you can do

- View current BTC, ETH, SOL, and HYPE perpetual mid prices.
- Pull down to refresh.
- Use the refresh button to retry the public API immediately.
- Leave the screen open for an automatic refresh every 15 seconds.

## What is not enabled

Wallet connection, leverage changes, deposits, withdrawals, and order submission
are not active. The “Review wallet plan” button explains this boundary and does
not request keys or sign anything.

## Safety

- Never enter a seed phrase or private key into a development build.
- Treat unexpected wallet prompts as unsafe.
- Confirm the network, asset, side, price, size, leverage, and slippage before
  approving any future order.
- Use testnet when authenticated trading development begins.
