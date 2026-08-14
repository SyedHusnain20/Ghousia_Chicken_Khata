import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const SNAPSHOT_FOLDER_NAME = 'Snapshots';
const KEEP_LAST_N_SNAPSHOTS = 12; // roughly a year of monthly checkpoints

function snapshotFolderPath(dbFolderPath: string): string {
  return path.join(dbFolderPath, SNAPSHOT_FOLDER_NAME);
}

function snapshotFileName(year: number, month: number): string {
  return `khata-${year}-${String(month).padStart(2, '0')}.db`;
}

export interface SnapshotInfo {
  fileName: string;
  filePath: string;
  createdAt: string; // file's mtime, ISO string
  sizeBytes: number;
}

export function listSnapshots(dbFolderPath: string): SnapshotInfo[] {
  const folder = snapshotFolderPath(dbFolderPath);
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((name) => name.startsWith('khata-') && name.endsWith('.db'))
    .map((name) => {
      const filePath = path.join(folder, name);
      const stat = fs.statSync(filePath);
      return {
        fileName: name,
        filePath,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      };
    })
    .sort((a, b) => b.fileName.localeCompare(a.fileName)); // newest first
}

/**
 * Creates this month's archival snapshot if it doesn't already exist.
 * Uses better-sqlite3's `.backup()`, which wraps SQLite's official online
 * backup API - safe to call while the live database is open and being
 * written to elsewhere in the app, unlike a plain file copy which could
 * grab a half-written file.
 *
 * Safe to call on every app startup: it's a no-op once this month's
 * snapshot already exists, so it doesn't matter if the shopkeeper opens
 * the app once a day or ten times a day.
 */
export async function ensureMonthlySnapshot(db: Database.Database, dbFolderPath: string): Promise<SnapshotInfo | null> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const folder = snapshotFolderPath(dbFolderPath);
  const destPath = path.join(folder, snapshotFileName(year, month));

  if (fs.existsSync(destPath)) return null; // already have this month's checkpoint

  fs.mkdirSync(folder, { recursive: true });
  await db.backup(destPath);
  pruneOldSnapshots(dbFolderPath);

  const stat = fs.statSync(destPath);
  return {
    fileName: path.basename(destPath),
    filePath: destPath,
    createdAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
  };
}

/**
 * Forces a snapshot right now, overwriting today's automatic one if it
 * already ran this month - used by the "Create Snapshot Now" button in
 * Settings so the shopkeeper isn't stuck waiting for next month.
 */
export async function createSnapshotNow(db: Database.Database, dbFolderPath: string): Promise<SnapshotInfo> {
  const now = new Date();
  const folder = snapshotFolderPath(dbFolderPath);
  const destPath = path.join(folder, snapshotFileName(now.getFullYear(), now.getMonth() + 1));
  fs.mkdirSync(folder, { recursive: true });
  fs.rmSync(destPath, { force: true });
  await db.backup(destPath);
  pruneOldSnapshots(dbFolderPath);
  const stat = fs.statSync(destPath);
  return {
    fileName: path.basename(destPath),
    filePath: destPath,
    createdAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
  };
}

function pruneOldSnapshots(dbFolderPath: string): void {
  const snapshots = listSnapshots(dbFolderPath); // newest first
  for (const old of snapshots.slice(KEEP_LAST_N_SNAPSHOTS)) {
    fs.rmSync(old.filePath, { force: true });
  }
}
