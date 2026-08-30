# Trading setup

Hyper Trader lets you browse markets without connecting a wallet. Trading setup
is optional. The implementation isolates setup by network. The current private
`candidate` build enables setup and every currently implemented action on both
testnet and mainnet. Mainnet setup and actions use real funds; the candidate is
not approved for public distribution.

## What setup authorizes

Hyper Trader creates a dedicated API wallet on your device. Enter only your
public master-wallet address; Hyper Trader never asks for or stores your seed
phrase or master private key. In the first setup step, choose Mainnet or Testnet;
Mainnet appears first and is selected by default. After system authentication,
copy the generated public API-wallet address to the official Hyperliquid API
page shown for the selected network, connect the same master wallet there, and
add it with the `Hyper Trader` name.

Choose the API-wallet expiry you want on Hyperliquid. Hyper Trader stores the
actual finite expiry reported by Hyperliquid. It is bound to the shown network, master
account, and selected master account, sub-account, or vault. A different target
needs a different API wallet.

Before approving, check:

- the network is exactly the one you intended to authorize;
- the connected master account is the one you intended;
- the selected target is correct;
- any named-agent slot or replacement warning shown by Hyperliquid is expected;
  and
- **Days valid** is finite and has not already expired.

When you return to Hyper Trader, verification starts automatically. **Check
again** is available if the API wallet is not visible yet. Hyper Trader enables
the credential only after Hyperliquid authoritatively reports the exact agent
address under the intended master account and a finite future expiry. The
wallet name is only a label and is not compared during verification.

## Device protection

The API-wallet key is stored in device-protected storage and is never displayed,
copied, backed up, or offered as a recovery phrase. The system authentication
prompt uses strong enrolled biometrics and may offer the device passcode fallback
managed by iOS or Android; Hyper Trader never creates or stores its own six-digit
PIN. Authentication unlocks one five-minute signing session only when a
confirmed action needs a signature. The timer starts at unlock and does not
extend when you sign. Every order, cancellation, leverage
change, or position close still has a separate review screen.

The session locks immediately when you lock it manually, change account or
network, background the app, lose Android focus, change the credential
generation, encounter an authentication error, or reach five minutes.

## Paused or unavailable setup

You can always choose **Finish later** and continue read-only. The public setup
phase is saved locally, and a staged API wallet can resume for 24 hours without
generating a second key. Unavailable device authentication, an expired attempt,
or a registration mismatch never enables trading. After 24 hours the staged key
is removed and setup must generate a fresh address; do not reuse the expired
agent address.

Manual authorization is available on both Hyperliquid testnet and mainnet in
the current `candidate` functional-testing build. Mainnet authorization and
actions use real funds and remain bound to the exact selected account and
network. The optional in-app Reown wallet connection remains disabled until its
release security and physical-device checks are approved.

## Loss, expiry, or device change

There is no secret export or recovery phrase. An expired, revoked, missing, or
biometrically invalidated API wallet requires a fresh device key and external
reauthorization. If a device is lost, revoke or replace its named agent from an
independently trusted Hyperliquid or wallet path.

If iOS preserves a Keychain record across reinstall, Hyper Trader quarantines it
instead of silently restoring account selection or a signing session. Android
uninstall is treated as credential loss.
