import { execSync } from 'child_process';

/**
 * Windows sets a unique GUID for every installation, stored in the
 * registry, the moment Windows itself is installed. It survives app
 * reinstalls, reboots, and normal use - exactly what's needed to bind an
 * activation code to "this specific computer" rather than "this specific
 * install of the app" (which would be trivially reset just by
 * reinstalling the app).
 *
 * It DOES change if Windows itself is reinstalled or the machine is
 * replaced - at that point the shopkeeper is, correctly, on what looks
 * like a new machine and needs a new activation code.
 *
 * Throws if it can't be read (should never happen on a real Windows
 * install) - callers should treat that as "activation not possible right
 * now" rather than silently falling back to something guessable/spoofable
 * like the computer's hostname.
 */
export function getMachineId(): string {
  const output = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
    encoding: 'utf-8',
    windowsHide: true,
  });
  // Output looks like:
  //   HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography
  //       MachineGuid    REG_SZ    a1b2c3d4-...
  const match = output.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/);
  if (!match) {
    throw new Error('Could not read this computer\u2019s Machine ID from the registry');
  }
  return match[1].toLowerCase();
}
