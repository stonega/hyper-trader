# Trading setup

Hyper Trader lets you browse markets without connecting a wallet. Trading setup
is optional and always uses Hyperliquid testnet in the current signing-capable
build.

## What setup authorizes

Hyper Trader creates a dedicated API wallet on your device. Your external master
wallet approves that API wallet for one exact account target. Hyper Trader never
asks for or stores your seed phrase or master private key.

The requested API-wallet authorization lasts 30 days. It is bound to the shown
network, master account, and selected master account, sub-account, or vault. A
different target needs a different API wallet.

Before approving, check:

- the network says Hyperliquid testnet;
- the connected master account is the one you intended;
- the selected target is correct;
- the stable named-agent slot and replacement warning are expected; and
- the absolute expiry and remaining duration are acceptable.

Returning from an external wallet does not prove success. Hyper Trader enables
the credential only after Hyperliquid authoritatively reports the exact agent
name, address, target relationship, and acceptable expiry.

## Device protection

The API-wallet key is stored in device-protected storage and is never displayed,
copied, backed up, or offered as a recovery phrase. Strong device authentication
unlocks one five-minute signing session. The timer starts at unlock and does not
extend when you sign. Every order, cancellation, leverage change, or position
close still has a separate review screen.

The session locks immediately when you lock it manually, change account or
network, background the app, lose Android focus, change the credential
generation, encounter an authentication error, or reach five minutes.

## Paused or unavailable setup

You can always choose **Continue read-only**. A rejected wallet request, invalid
return link, unavailable device authentication, expired ten-minute setup
attempt, or registration mismatch never enables trading. Resume setup from its
entry point rather than repeating Welcome.

The current repository build deliberately keeps live external wallet approval
disabled until its release security and physical-device checks are approved. It
does not submit a real authorization while that notice is shown.

## Loss, expiry, or device change

There is no secret export or recovery phrase. An expired, revoked, missing, or
biometrically invalidated API wallet requires a fresh device key and external
reauthorization. If a device is lost, revoke or replace its named agent from an
independently trusted Hyperliquid or wallet path.

If iOS preserves a Keychain record across reinstall, Hyper Trader quarantines it
instead of silently restoring account selection or a signing session. Android
uninstall is treated as credential loss.
