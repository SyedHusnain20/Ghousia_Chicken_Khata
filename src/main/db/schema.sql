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

-- Shopkeepers behave exactly like suppliers (purchases, payments, bills) -
-- kept as their own separate tables (rather than folding into suppliers)
-- so their accounts and history never mix with actual chicken suppliers'.
CREATE TABLE IF NOT EXISTS shopkeepers (
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

CREATE TABLE IF NOT EXISTS shopkeeper_bills (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  shopkeeper_id        INTEGER NOT NULL REFERENCES shopkeepers(id),
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

CREATE TABLE IF NOT EXISTS shopkeeper_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shopkeeper_id INTEGER NOT NULL REFERENCES shopkeepers(id),
  entry_date    TEXT NOT NULL DEFAULT (datetime('now')),
  item_name     TEXT NOT NULL DEFAULT 'Chicken',
  weight_kg     REAL NOT NULL,
  rate_per_kg   REAL NOT NULL,
  line_total    REAL NOT NULL,
  bill_id       INTEGER REFERENCES shopkeeper_bills(id)
);

-- Every payment, from either entry point (bill-time or standalone profile
-- field). No CHECK constraint on party_type - the app's PartyType union
-- already enforces valid values at the TypeScript level, and a DB-level
-- allowed-list here would need a schema migration every time a new party
-- type is added (as happened when 'shopkeeper' was introduced).
CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type     TEXT NOT NULL,
  party_id       INTEGER NOT NULL,
  bill_id        INTEGER,             -- NULL if this was a standalone payment
  amount         REAL NOT NULL,
  payment_method TEXT,                -- 'online' | 'cash' - nullable so old payments (recorded before this field existed) just show blank, not a fake default
  paid_at        TEXT NOT NULL DEFAULT (datetime('now')),
  note           TEXT
);

CREATE INDEX IF NOT EXISTS idx_supplier_entries_unbilled
  ON supplier_entries (supplier_id) WHERE bill_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_entries_unbilled
  ON customer_entries (customer_id) WHERE bill_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_shopkeeper_entries_unbilled
  ON shopkeeper_entries (shopkeeper_id) WHERE bill_id IS NULL;

-- Daily Ledger: one row per business date, created explicitly by the
-- shopkeeper (UNIQUE constraint makes accidental duplicates for the same
-- date structurally impossible). Holds the manual fields - Sale, Extra
-- Expenses, and the Items Left breakdown (unsold Live Chicken / Chicken
-- Meat / Lever, each weight + rate + an optional override total). Supplier
-- purchases and Khata customer sales are NOT duplicated here; they're
-- aggregated live from supplier_entries/customer_entries by date, so there
-- is exactly one source of truth for every transaction. sale_income and
-- extra_expenses are whole rupees (INTEGER) - this app never deals in
-- paisas (see floorMoney). Each item's *_total is likewise a whole-rupee
-- INTEGER: it's either typed in directly or, when left blank, computed as
-- floor(weight_kg * rate) - same convention as line_total elsewhere.
CREATE TABLE IF NOT EXISTS daily_ledgers (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_date            TEXT NOT NULL UNIQUE,   -- 'YYYY-MM-DD'
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

-- Daily Ledger "Udhar": informal credit sales for the day that don't belong
-- to a Khata customer profile - just a name and an amount, as many rows per
-- day as needed. Keyed by ledger_date (not a foreign key to daily_ledgers.id)
-- for the same reason supplier/customer entries are: everything on the Daily
-- Ledger page is looked up by business date. The rows are saved as a whole
-- set per date (see saveDailyLedgerUdhars) and the Udhar total is always
-- summed live from them, never stored, so it can't drift. amount is a whole
-- rupee INTEGER like every other money column on the ledger.
CREATE TABLE IF NOT EXISTS daily_ledger_udhars (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_date TEXT NOT NULL,              -- 'YYYY-MM-DD'
  name        TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_ledger_udhars_date ON daily_ledger_udhars (ledger_date);

-- Needed to aggregate supplier/customer entries by calendar date
-- efficiently once the entries table has months of history in it.
CREATE INDEX IF NOT EXISTS idx_supplier_entries_date ON supplier_entries (entry_date);
CREATE INDEX IF NOT EXISTS idx_customer_entries_date ON customer_entries (entry_date);
CREATE INDEX IF NOT EXISTS idx_shopkeeper_entries_date ON shopkeeper_entries (entry_date);