-- Khata App schema
-- One "party" is either a supplier or a customer. We keep them as separate
-- tables (rather than one generic table) since real-world attributes may
-- diverge later, but the logic that operates on them is shared in code.

CREATE TABLE IF NOT EXISTS suppliers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  contact_number TEXT,
  opening_due   REAL NOT NULL DEFAULT 0,   -- due carried in from before the app was used
  current_due   REAL NOT NULL DEFAULT 0,   -- running due; can go negative (credit)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  contact_number TEXT,
  opening_due   REAL NOT NULL DEFAULT 0,
  current_due   REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplier_bills (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id          INTEGER NOT NULL REFERENCES suppliers(id),
  bill_date            TEXT NOT NULL DEFAULT (datetime('now')),
  previous_due         REAL NOT NULL,
  subtotal             REAL NOT NULL,       -- sum of entries swept into this bill
  total_due_after_bill REAL NOT NULL,       -- previous_due + subtotal, before payment
  remaining_due        REAL NOT NULL        -- after any payment recorded at generation time
);

CREATE TABLE IF NOT EXISTS customer_bills (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id          INTEGER NOT NULL REFERENCES customers(id),
  bill_date            TEXT NOT NULL DEFAULT (datetime('now')),
  previous_due         REAL NOT NULL,
  subtotal             REAL NOT NULL,
  total_due_after_bill REAL NOT NULL,
  remaining_due        REAL NOT NULL
);

-- Purchase entries logged as they happen. bill_id stays NULL until they
-- get swept into a generated bill; once set, the entry is considered locked.
CREATE TABLE IF NOT EXISTS supplier_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id  INTEGER NOT NULL REFERENCES suppliers(id),
  entry_date   TEXT NOT NULL DEFAULT (datetime('now')),
  item_name    TEXT NOT NULL DEFAULT 'Chicken',
  weight_kg    REAL NOT NULL,
  rate_per_kg  REAL NOT NULL,
  line_total   REAL NOT NULL,
  bill_id      INTEGER REFERENCES supplier_bills(id)
);

CREATE TABLE IF NOT EXISTS customer_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  entry_date   TEXT NOT NULL DEFAULT (datetime('now')),
  item_name    TEXT NOT NULL DEFAULT 'Chicken',
  weight_kg    REAL NOT NULL,
  rate_per_kg  REAL NOT NULL,
  line_total   REAL NOT NULL,
  bill_id      INTEGER REFERENCES customer_bills(id)
);

-- Every payment, from either entry point (bill-time or standalone profile field).
CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type TEXT NOT NULL CHECK (party_type IN ('supplier', 'customer')),
  party_id   INTEGER NOT NULL,
  bill_id    INTEGER,             -- NULL if this was a standalone payment
  amount     REAL NOT NULL,
  paid_at    TEXT NOT NULL DEFAULT (datetime('now')),
  note       TEXT
);

CREATE INDEX IF NOT EXISTS idx_supplier_entries_unbilled
  ON supplier_entries (supplier_id) WHERE bill_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_entries_unbilled
  ON customer_entries (customer_id) WHERE bill_id IS NULL;
