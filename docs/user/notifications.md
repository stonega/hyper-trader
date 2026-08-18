# Notifications

Hyper Trader supports text-only trading alerts on native iOS and Android. Push
alerts are informational. They never place, cancel, or modify an order and never
unlock an API wallet.

## Add a price alert

1. Open **Settings** and choose **Manage notifications**.
2. Enter the exact canonical market ID shown in Markets, such as `perp:BTC`.
3. Choose **Price above** or **Price below**, then enter the threshold.
4. Choose **Add price alert**.
5. If this is the first alert, respond to the system notification prompt.

If permission is denied, Hyper Trader says so and creates no alert. Open the
device's system settings if you later want to allow notifications. iOS may grant
provisional or ephemeral access; Hyper Trader reports that status separately.

Price alerts do not need a wallet or account link. Fill, cancellation, rejection,
margin-risk, liquidation-risk, and funding alerts require fresh proof from the
exact master wallet for every change. Those controls remain disabled until the
reviewed wallet connector is available; the app will not claim they are active.

## Open an alert safely

A notification contains only an opaque alert identifier and broad routing hints.
It does not contain your address, balance, position, order details, wallet key,
or signature.

When you tap an alert, Hyper Trader:

1. retrieves the authorized alert record from the notification service;
2. checks that the rule, market, and exact saved account still exist;
3. asks before changing your active network or account;
4. refreshes current public Hyperliquid market and, when required, account state;
5. then offers the Trade or Portfolio screen.

Declining the context change leaves your current context unchanged. A duplicate,
expired, removed, revoked, malformed, or delisted alert shows an unavailable
message instead of stale state.

## Delivery status and device revoke

The notification settings screen reports permission, token, and delivery health.
Push delivery is best effort: connectivity, device power policy, force-quit,
provider throttling, or OS policy can delay or suppress an alert. Keep exchange
risk controls independent of push delivery.

You can delete individual price alerts. Choose **Revoke notification device** to
remove the installation. If the service says work is still draining, Hyper Trader
does not claim revocation is complete and keeps the local authority until the
service verifies the installation is inactive. **Retry device revocation** uses
the same saved operation; it does not start a second deletion. New alerts remain
blocked while that operation is unresolved.

## Privacy and troubleshooting

- Never approve an unexpected wallet prompt from a notification.
- Hyper Trader does not store full push tokens in its local rule/dedupe state or
  include token suffixes in diagnostic exports.
- Notification background work never signs, trades, unlocks, or changes account
  context.
- If a token changes while account alerts exist, fresh master-wallet proof is
  required before those alerts can resume.
- If first-time registration is interrupted, retry the same alert action. Hyper
  Trader keeps the device-bound installation checkpoint and verifies whether the
  service already created it before retrying.
- If the app says push configuration is unavailable, that build is missing a
  reviewed service origin, linked EAS project ID, or provider credentials.
