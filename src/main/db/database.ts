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
  db.pragma('journal_mode = WAL'); // safer against crashes mid-write
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  return db;
}
