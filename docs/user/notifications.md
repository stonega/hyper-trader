# Notifications

Notification controls are not currently available in Hyper Trader. They remain
hidden until the notification service and physical-device delivery flow are
deployed and reviewed.

The planned native iOS and Android alerts are informational. They will never
place, cancel, or modify an order and will never unlock an API wallet.

## Safe notification behavior

A future notification will contain only an opaque alert identifier and broad
routing hints. It will not contain your address, balance, position, order
details, wallet key, or signature.

After notifications are released, Hyper Trader will:

1. retrieve the authorized alert record from the notification service;
2. check that the rule, market, and exact saved account still exist;
3. ask before changing your active network or account;
4. refresh current public Hyperliquid market and, when required, account state;
5. then offer the Trade or Portfolio screen.

Declining the context change leaves your current context unchanged. A duplicate,
expired, removed, revoked, malformed, or delisted alert shows an unavailable
message instead of stale state.

Push delivery will remain best effort: connectivity, device power policy,
force-quit, provider throttling, or OS policy can delay or suppress an alert.
Keep exchange risk controls independent of push delivery.

## Privacy

- Never approve an unexpected wallet prompt from a notification.
- Hyper Trader does not store full push tokens in its local rule/dedupe state or
  include token suffixes in diagnostic exports.
- Notification background work never signs, trades, unlocks, or changes account
  context.
