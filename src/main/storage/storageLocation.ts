import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import Database from 'better-sqlite3';

// The live database's filename never changes, regardless of which folder
// it lives in.
export const DB_FILE_NAME = 'khata.db';

// Small local pointer file - NOT the database itself, just remembers which
// folder the shopkeeper chose on THIS laptop. Lives outside the synced
// folder (in Electron's per-user app-data dir) so it never gets swept up
// by OneDrive and never needs to be backed up itself; it's trivially
// recreated by the first-run picker if it ever goes missing.
function configFilePath(): string {
  return path.join(app.getPath('userData'), 'storage-config.json');
}

interface StorageConfig {
  dbFolderPath: string;
}

function readConfig(): StorageConfig | null {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.dbFolderPath === 'string' && parsed.dbFolderPath.length > 0) {
      return { dbFolderPath: parsed.dbFolderPath };
    }
    return null;
  } catch {
    return null; // no config yet, or it's corrupt - either way, treat as first run
  }
}

function writeConfig(config: StorageConfig): void {
  fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
  fs.writeFileSync(configFilePath(), JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Reads the OneDrive path Windows itself set up for whichever user is
 * logged into THIS laptop. Nothing here is hardcoded to any specific PC -
 * `OneDrive`/`OneDriveConsumer` are environment variables the OneDrive
 * installer sets per-machine, per-user, so this resolves correctly on
 * every shopkeeper's own laptop without any prior knowledge of their
 * username or account.
 *
 * Returns null if OneDrive isn't installed/signed in on this machine.
 */
export function detectOneDrivePath(): string | null {
  const candidate = process.env.OneDrive || process.env.OneDriveConsumer;
  if (!candidate) return null;
  try {
    if (fs.statSync(candidate).isDirectory()) return candidate;
  } catch {
    // env var set but folder doesn't actually exist (stale profile, etc.)
  }
  return null;
}

export interface ResolvedStorage {
  dbFolderPath: string;
  dbFilePath: string;
  isFirstRun: boolean;
}

/**
 * The one function main/index.ts calls at startup. Reads the saved config
 * from THIS laptop; if it's missing or the folder has vanished (drive
 * unplugged, OneDrive uninstalled, folder renamed), reports isFirstRun so
 * index.ts can re-run the folder-picker flow instead of silently creating
 * a fresh, empty database in the wrong place.
 */
export function resolveStorageFolder(): { dbFolderPath: string; isFirstRun: boolean } {
  const config = readConfig();
  if (config && fs.existsSync(config.dbFolderPath)) {
    return { dbFolderPath: config.dbFolderPath, isFirstRun: false };
  }
  // Fall back to the app's own data folder until the shopkeeper picks a
  // real location - keeps the app usable even if they dismiss the picker.
  return { dbFolderPath: app.getPath('userData'), isFirstRun: true };
}

export function saveStorageFolder(dbFolderPath: string): void {
  writeConfig({ dbFolderPath });
}

export function dbFilePathFor(dbFolderPath: string): string {
  return path.join(dbFolderPath, DB_FILE_NAME);
}

/**
 * Cheap sanity check that a file the shopkeeper picked to restore from is
 * actually a khata database, not some unrelated .db file - opens it
 * read-only and looks for one of the app's own tables rather than trying
 * to fully validate the schema.
 */
export function isValidKhataDatabase(filePath: string): boolean {
  try {
    const testDb = new Database(filePath, { readonly: true, fileMustExist: true });
    try {
      const row = testDb
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'suppliers'")
        .get();
      return row !== undefined;
    } finally {
      testDb.close();
    }
  } catch {
    return false;
  }
}

/**
 * Replaces the live database with the contents of a chosen backup file.
 * Always safety-copies the CURRENT live data first (into the same folder,
 * clearly named), so restoring is itself never a one-way door - if the
 * shopkeeper picks the wrong backup, their pre-restore data is still
 * sitting right there to restore back from.
 *
 * Caller must close the current DB connection before calling this, and
 * restart the app afterwards to reopen it fresh.
 */
export function restoreDatabaseFrom(currentDbPath: string, backupFilePath: string): { safetyBackupPath: string } {
  const folder = path.dirname(currentDbPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyBackupPath = path.join(folder, `khata-before-restore-${timestamp}.db`);

  fs.copyFileSync(currentDbPath, safetyBackupPath);
  fs.copyFileSync(backupFilePath, currentDbPath);
  fs.rmSync(`${currentDbPath}-journal`, { force: true });

  return { safetyBackupPath };
}

export function moveDatabaseTo(currentDbPath: string, newFolderPath: string, allowOverwrite = false): void {
  const destPath = dbFilePathFor(newFolderPath);
  if (!allowOverwrite && fs.existsSync(destPath)) {
    throw new Error('DESTINATION_HAS_DATABASE');
  }
  fs.mkdirSync(newFolderPath, { recursive: true });
  fs.copyFileSync(currentDbPath, destPath);
  // Verify the copy landed correctly before touching the original.
  const srcStat = fs.statSync(currentDbPath);
  const destStat = fs.statSync(destPath);
  if (destStat.size !== srcStat.size) {
    throw new Error('COPY_VERIFICATION_FAILED');
  }
  fs.rmSync(currentDbPath, { force: true });
  // journal_mode is DELETE (see db/database.ts), so under normal
  // shutdown there's no stray -wal/-shm file, but a leftover -journal
  // can exist if the app crashed mid-write - harmless to leave behind
  // since a fresh journal is recreated as needed, but clean it up if
  // present so it doesn't confuse anyone browsing the old folder.
  fs.rmSync(`${currentDbPath}-journal`, { force: true });
  writeConfig({ dbFolderPath: newFolderPath });
}
