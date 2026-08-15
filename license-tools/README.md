# License Tools (YOU ONLY - never ship this folder)

This folder is for generating activation codes for clients. It is never
built into the app, never installed on a client's PC - it's a plain
Node.js script you run on your own machine only.

## One-time setup

1. Save your private key (given to you separately, **not** committed to
   this repo) as:
   ```
   license-tools/private-key.pem
   ```
2. Confirm `.gitignore` excludes it (already set up - see the repo root
   `.gitignore`). Double check with:
   ```
   git status
   ```
   `private-key.pem` should NOT appear as a file git wants to add.
3. Keep a backup of `private-key.pem` somewhere safe (password manager,
   encrypted USB) - if you lose it, you can't issue any *new* activation
   codes (already-activated installs keep working fine either way, since
   they only ever needed the public key).

## Issuing a code to a client

1. Client opens the app on their new/unactivated PC, sees the "Activation
   Required" screen with their Machine ID.
2. They send you that Machine ID (WhatsApp, call, however).
3. Run:
   ```
   node license-tools/generate-code.js <machine-id-they-sent-you>
   ```
4. Send the printed "Activation code" back to them. They paste it into
   the app once - it's saved locally on their machine and never needed
   again on that PC.

## If a legitimate client gets a new/replaced PC

Windows' Machine ID changes if Windows itself is reinstalled or they get
a new computer - the app will show a *new* Machine ID and ask for
activation again. That's expected, not a bug. Verify it's really them,
then just generate a new code for their new Machine ID the same way.
