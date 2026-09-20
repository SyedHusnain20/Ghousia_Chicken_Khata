import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// A password must be at least this long. Kept short on purpose so a
// shopkeeper can use a simple PIN-style password - the lock is there to
// keep casual visitors out of the books, not to defend against a
// determined attacker (see the note on AppLock below).
export const MIN_PASSWORD_LENGTH = 4;

// After this many wrong passwords in a row, further attempts are refused
// for LOCKOUT_MS. Resets on success or when the app restarts.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

// scrypt parameters (Node's defaults, spelled out so they're stored with
// the hash and can be raised later without breaking existing passwords).
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64, saltLength: 16 } as const;

interface StoredPassword {
  version: 1;
  salt: string; // base64
  hash: string; // base64
  N: number;
  r: number;
  p: number;
  keyLength: number;
}

/**
 * The app's start-up password.
 *
 * - The password is stored only as a salted scrypt hash, in a small file
 *   that lives on THIS laptop (Electron's per-user app-data folder) - not
 *   in the database, so it is not swept into OneDrive, and restoring an
 *   old backup of the database can never roll the password back.
 * - "Unlocked" is a flag held in the main process's memory. It starts
 *   false every time the app process starts, and only ever becomes true
 *   after the correct password (or after setting the very first one). It
 *   is never written to disk, so closing the app - or turning the laptop
 *   off and on - always locks it again, while minimizing, switching
 *   windows/tabs, or reloading the page inside a running app does not.
 *
 * This is an app-level lock. It is not disk encryption: the database file
 * itself is not encrypted, so someone with access to the files on the
 * laptop can still read them outside the app.
 */
export class AppLock {
  private unlocked = false;
  private failedAttempts = 0;
  private lockedUntil = 0;

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now
  ) {}

  hasPassword(): boolean {
    return this.readStored() !== null;
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  /** First-time setup. Only allowed while no password exists yet. */
  setInitialPassword(password: string, confirmPassword: string): void {
    if (this.hasPassword()) {
      throw new Error('A password has already been set.');
    }
    this.validateNewPassword(password, confirmPassword);
    this.writeStored(this.hash(password));
    this.unlocked = true;
    this.resetAttempts();
  }

  /** Called from the lock screen at start-up. Throws on a wrong password. */
  unlock(password: string): void {
    if (!this.hasPassword()) {
      throw new Error('No password has been set yet.');
    }
    this.checkPassword(password);
    this.unlocked = true;
  }

  /** Settings > Change Password. Needs the app to already be unlocked. */
  changePassword(currentPassword: string, newPassword: string, confirmNewPassword: string): void {
    if (!this.unlocked) {
      throw new Error('The app is locked. Please enter your password.');
    }
    if (!this.hasPassword()) {
      throw new Error('No password has been set yet.');
    }
    this.checkPassword(currentPassword, 'Current password is incorrect.');
    this.validateNewPassword(newPassword, confirmNewPassword);
    if (newPassword === currentPassword) {
      throw new Error('The new password must be different from the current password.');
    }
    this.writeStored(this.hash(newPassword));
  }

  // ---- internals ----

  private validateNewPassword(password: string, confirmPassword: string): void {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
    }
    if (password !== confirmPassword) {
      throw new Error('The passwords you entered don\u2019t match.');
    }
  }

  private checkPassword(password: string, wrongMessage = 'Incorrect password.'): void {
    const remainingMs = this.lockedUntil - this.now();
    if (remainingMs > 0) {
      throw new Error(`Too many wrong attempts. Please wait ${Math.ceil(remainingMs / 1000)} seconds and try again.`);
    }

    const stored = this.readStored();
    if (!stored || typeof password !== 'string' || !this.matches(password, stored)) {
      this.failedAttempts += 1;
      if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        this.failedAttempts = 0;
        this.lockedUntil = this.now() + LOCKOUT_MS;
        throw new Error(
          `${wrongMessage} Too many wrong attempts - please wait ${LOCKOUT_MS / 1000} seconds before trying again.`
        );
      }
      throw new Error(wrongMessage);
    }
    this.resetAttempts();
  }

  private resetAttempts(): void {
    this.failedAttempts = 0;
    this.lockedUntil = 0;
  }

  private hash(password: string): StoredPassword {
    const salt = crypto.randomBytes(SCRYPT.saltLength);
    const derived = crypto.scryptSync(password, salt, SCRYPT.keyLength, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
    return {
      version: 1,
      salt: salt.toString('base64'),
      hash: derived.toString('base64'),
      N: SCRYPT.N,
      r: SCRYPT.r,
      p: SCRYPT.p,
      keyLength: SCRYPT.keyLength,
    };
  }

  private matches(password: string, stored: StoredPassword): boolean {
    const expected = Buffer.from(stored.hash, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(stored.salt, 'base64'), stored.keyLength, {
      N: stored.N,
      r: stored.r,
      p: stored.p,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  private readStored(): StoredPassword | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (
        parsed &&
        parsed.version === 1 &&
        typeof parsed.salt === 'string' &&
        typeof parsed.hash === 'string' &&
        Number.isInteger(parsed.N) &&
        Number.isInteger(parsed.r) &&
        Number.isInteger(parsed.p) &&
        Number.isInteger(parsed.keyLength)
      ) {
        return parsed as StoredPassword;
      }
      return null;
    } catch {
      return null; // no file yet (or unreadable) - treated as "no password set"
    }
  }

  // Write to a temp file and rename over the real one, so a crash or power
  // cut mid-write can never leave a half-written (and therefore unusable)
  // password file behind.
  private writeStored(stored: StoredPassword): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(stored), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }
}
