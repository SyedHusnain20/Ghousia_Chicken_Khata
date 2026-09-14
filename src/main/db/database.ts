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

  runMigrations(db);

  return db;
}

/**
 * Evolves a database that already existed before this version of the app -
 * CREATE TABLE IF NOT EXISTS (in schema.sql, run above) only creates
 * tables that don't exist yet; it can't add a column to or change a CHECK
 * constraint on a table a client's live database already has. Every step
 * here checks the database's actual current state first, so running this
 * on every startup (including on a brand-new database that already has
 * the latest shape from schema.sql) is always a safe no-op.
 */
function runMigrations(db: Database.Database): void {
  const paymentColumns = db.prepare('PRAGMA table_info(payments)').all() as { name: string }[];
  if (!paymentColumns.some((c) => c.name === 'payment_method')) {
    db.exec('ALTER TABLE payments ADD COLUMN payment_method TEXT');
  }

  // SQLite has no ALTER TABLE for dropping/loosening a CHECK constraint -
  // the only way to remove the old ('supplier','customer')-only constraint
  // (so 'shopkeeper' payments are accepted) is to rebuild the table. Only
  // runs once per database: after the first run, the constraint is gone
  // and this check is skipped on every future startup.
  const tableDef = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payments'")
    .get() as { sql: string } | undefined;
  if (tableDef && tableDef.sql.includes('CHECK')) {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE payments_new (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        party_type     TEXT NOT NULL,
        party_id       INTEGER NOT NULL,
        bill_id        INTEGER,
        amount         REAL NOT NULL,
        payment_method TEXT,
        paid_at        TEXT NOT NULL DEFAULT (datetime('now')),
        note           TEXT
      );
      INSERT INTO payments_new (id, party_type, party_id, bill_id, amount, payment_method, paid_at, note)
        SELECT id, party_type, party_id, bill_id, amount, payment_method, paid_at, note FROM payments;
      DROP TABLE payments;
      ALTER TABLE payments_new RENAME TO payments;
      COMMIT;
    `);
  }

  // daily_ledgers: old databases have "cash_customer_income" (REAL) and no
  // Items Left columns at all. A rebuild is required here (not just
  // RENAME/ADD COLUMN) because the money columns also need to go from REAL
  // to INTEGER affinity - values are re-floored on the way across so no
  // fractional rupee that may have slipped in gets carried forward.
  const ledgerColumns = db.prepare('PRAGMA table_info(daily_ledgers)').all() as { name: string }[];
  const hasOldCashColumn = ledgerColumns.some((c) => c.name === 'cash_customer_income');
  const hasSaleColumn = ledgerColumns.some((c) => c.name === 'sale_income');

  if (hasOldCashColumn && !hasSaleColumn) {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE daily_ledgers_new (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_date            TEXT NOT NULL UNIQUE,
        sale_income            INTEGER NOT NULL DEFAULT 0,
        extra_expenses         INTEGER NOT NULL DEFAULT 0,
        live_chicken_weight_kg REAL NOT NULL DEFAULT 0,
        live_chicken_rate      REAL NOT NULL DEFAULT 0,
        live_chicken_total     INTEGER NOT NULL DEFAULT 0,
        chicken_meat_weight_kg REAL NOT NULL DEFAULT 0,
        chicken_meat_rate      REAL NOT NULL DEFAULT 0,
        chicken_meat_total     INTEGER NOT NULL DEFAULT 0,
        lever_weight_kg        REAL NOT NULL DEFAULT 0,
        lever_rate             REAL NOT NULL DEFAULT 0,
        lever_total            INTEGER NOT NULL DEFAULT 0,
        created_at             TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO daily_ledgers_new (id, ledger_date, sale_income, extra_expenses, created_at, updated_at)
        SELECT id, ledger_date, CAST(ROUND(cash_customer_income) AS INTEGER), CAST(ROUND(extra_expenses) AS INTEGER),
               created_at, updated_at
        FROM daily_ledgers;
      DROP TABLE daily_ledgers;
      ALTER TABLE daily_ledgers_new RENAME TO daily_ledgers;
      COMMIT;
    `);
  } else {
    // Table already has sale_income (either a brand-new DB from schema.sql,
    // or one that went through the rebuild above in an earlier run) - just
    // make sure every Items Left column exists, in case this database was
    // last migrated by an earlier version of this app that didn't have them
    // yet.
    const currentColumns = db.prepare('PRAGMA table_info(daily_ledgers)').all() as { name: string }[];
    const itemColumnDefs: [string, string][] = [
      ['live_chicken_weight_kg', 'REAL NOT NULL DEFAULT 0'],
      ['live_chicken_rate', 'REAL NOT NULL DEFAULT 0'],
      ['live_chicken_total', 'INTEGER NOT NULL DEFAULT 0'],
      ['chicken_meat_weight_kg', 'REAL NOT NULL DEFAULT 0'],
      ['chicken_meat_rate', 'REAL NOT NULL DEFAULT 0'],
      ['chicken_meat_total', 'INTEGER NOT NULL DEFAULT 0'],
      ['lever_weight_kg', 'REAL NOT NULL DEFAULT 0'],
      ['lever_rate', 'REAL NOT NULL DEFAULT 0'],
      ['lever_total', 'INTEGER NOT NULL DEFAULT 0'],
    ];
    for (const [name, def] of itemColumnDefs) {
      if (!currentColumns.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE daily_ledgers ADD COLUMN ${name} ${def}`);
      }
    }
  }
}
