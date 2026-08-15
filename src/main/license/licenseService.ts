import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import { getMachineId } from './machineId';
import { LICENSE_PUBLIC_KEY_PEM } from './publicKey';

function licenseFilePath(): string {
  // Deliberately NOT inside the OneDrive-synced data folder (see
  // storage/storageLocation.ts) - this must stay local to this specific
  // Windows profile so it never gets copied along with the business data
  // to a different computer.
  return path.join(app.getPath('userData'), 'license.json');
}

interface StoredLicense {
  machineId: string;
  code: string; // base64url-encoded Ed25519 signature over machineId
}

function verifyCodeForMachine(machineId: string, code: string): boolean {
  try {
    const signature = Buffer.from(code, 'base64url');
    const publicKey = crypto.createPublicKey(LICENSE_PUBLIC_KEY_PEM);
    return crypto.verify(null, Buffer.from(machineId, 'utf-8'), publicKey, signature);
  } catch {
    return false; // malformed code (bad base64, wrong length, etc.)
  }
}

export interface ActivationStatus {
  activated: boolean;
  machineId: string;
}

/**
 * The one function index.ts calls at startup. Reads whatever's stored
 * locally (if anything) and re-verifies it against THIS machine's current
 * ID every time - never just trusts "a license.json file exists" the way
 * a weaker check might.
 */
export function checkActivation(): ActivationStatus {
  const machineId = getMachineId();
  try {
    const raw = fs.readFileSync(licenseFilePath(), 'utf-8');
    const stored = JSON.parse(raw) as StoredLicense;
    const activated = stored.machineId === machineId && verifyCodeForMachine(machineId, stored.code);
    return { activated, machineId };
  } catch {
    return { activated: false, machineId }; // no license file yet, or unreadable
  }
}

/**
 * Called when the shopkeeper submits a code on the activation screen.
 * Verifies it BEFORE saving anything - never writes an unverified code to
 * disk. Returns whether it was accepted.
 */
export function tryActivate(enteredCode: string): boolean {
  const machineId = getMachineId();
  // Activation codes are shared over WhatsApp/SMS/voice, so tolerate
  // whitespace/line-break noise from copy-paste without being lenient
  // about the actual code content.
  const cleaned = enteredCode.replace(/\s+/g, '');
  if (!verifyCodeForMachine(machineId, cleaned)) return false;

  const record: StoredLicense = { machineId, code: cleaned };
  fs.mkdirSync(path.dirname(licenseFilePath()), { recursive: true });
  fs.writeFileSync(licenseFilePath(), JSON.stringify(record, null, 2), 'utf-8');
  return true;
}
