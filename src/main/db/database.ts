import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

/**
 * Opens (or creates) the local SQLite database file and ensures the schema
 * exists. In the real app this path will live in the user's app-data folder
 * (e.g. via Electron's app.getPath('userData')); for now it's passed in
 * explicitly so this module is easy to test in isolation.
 */
export function openDatabase(filePath: string): Database.Database {
  const db = new Database(filePath);
  // WAL mode keeps recent commits in a separate -wal file that only gets
  // folded into the main file on checkpoint. That's fine on a local disk,
  // but this database file can live inside a OneDrive-synced folder, and a
  // sync running mid-way between commit and checkpoint could upload a
  // khata.db that's missing recent transactions, or a .db/-wal/-shm trio
  // that goes out of sync with each other. DELETE mode (SQLite's default)
  // writes every committed transaction fully into khata.db itself and
  // removes the journal right after, so whatever OneDrive grabs at any
  // moment is always one complete, self-contained file.
  db.pragma('journal_mode = DELETE');
  // A cloud-sync client can briefly hold an OS-level lock on the file
  // while it scans/uploads it. Without this, that shows up to the
  // shopkeeper as a scary write error; with it, better-sqlite3 just
  // retries internally for up to 3s before giving up.
  db.pragma('busy_timeout = 3000');
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  return db;
}
