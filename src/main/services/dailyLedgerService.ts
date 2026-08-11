import Database from 'better-sqlite3';
import { DailyLedger, DailyLedgerDetail, DailyLedgerSummary, EntryWithPartyName } from '../types';
import { round2, DATE_ONLY_RE } from './partyService';

function assertValidDate(date: string): void {
  if (!DATE_ONLY_RE.test(date)) {
    throw new Error("Date must be in 'YYYY-MM-DD' format");
  }
}

/**
 * Explicitly creates the ledger row for a business date. Required before
 * that date's cash/extra-expense fields can be edited - this is the "New
 * Ledger" action the shopkeeper takes once per day. The UNIQUE constraint
 * on ledger_date is the real guard against duplicates; the SELECT below
 * just turns that into a clear error message instead of a raw SQLite one.
 */
export function createDailyLedger(db: Database.Database, ledgerDate: string): DailyLedger {
  assertValidDate(ledgerDate);

  const existing = db
    .prepare('SELECT * FROM daily_ledgers WHERE ledger_date = ?')
    .get(ledgerDate) as DailyLedger | undefined;
  if (existing) {
    throw new Error(`A Daily Ledger for ${ledgerDate} already exists`);
  }

  const result = db
    .prepare('INSERT INTO daily_ledgers (ledger_date) VALUES (?)')
    .run(ledgerDate);

  return db.prepare('SELECT * FROM daily_ledgers WHERE id = ?').get(result.lastInsertRowid) as DailyLedger;
}

/**
 * Supplier purchases for one date, with the supplier's name attached.
 * Rule 1/2 (spec section 31): a purchase is the expense; a payment
 * against the supplier's due is NOT included here at all - payments live
 * only in the `payments` table and never touch entry_date-based queries.
 */
function getSupplierPurchasesForDate(db: Database.Database, date: string): EntryWithPartyName[] {
  return db
    .prepare(
      `SELECT se.*, se.supplier_id AS party_id, s.name AS party_name
       FROM supplier_entries se
       JOIN suppliers s ON s.id = se.supplier_id
       WHERE date(se.entry_date) = ?
       ORDER BY se.entry_date`
    )
    .all(date) as EntryWithPartyName[];
}

/**
 * Khata customer sales for one date, with the customer's name attached.
 * Rule 3/4: a sale is the income; a payment collecting an existing due is
 * NOT included here - same separation as suppliers above. Cash-customer
 * sales are never in this table at all (spec section 2), so this query
 * naturally only ever returns credit/Khata sales.
 */
function getKhataSalesForDate(db: Database.Database, date: string): EntryWithPartyName[] {
  return db
    .prepare(
      `SELECT ce.*, ce.customer_id AS party_id, c.name AS party_name
       FROM customer_entries ce
       JOIN customers c ON c.id = ce.customer_id
       WHERE date(ce.entry_date) = ?
       ORDER BY ce.entry_date`
    )
    .all(date) as EntryWithPartyName[];
}

/**
 * The full Daily Ledger view for one date. Throws if no ledger has been
 * created for that date yet (see createDailyLedger). Every total here is
 * computed fresh from supplier_entries/customer_entries - nothing about
 * supplier or Khata activity is read from or written to daily_ledgers.
 */
export function getDailyLedger(db: Database.Database, ledgerDate: string): DailyLedgerDetail {
  assertValidDate(ledgerDate);

  const ledger = db
    .prepare('SELECT * FROM daily_ledgers WHERE ledger_date = ?')
    .get(ledgerDate) as DailyLedger | undefined;
  if (!ledger) {
    throw new Error(`No Daily Ledger exists for ${ledgerDate} yet - create it first`);
  }

  const supplierPurchases = getSupplierPurchasesForDate(db, ledgerDate);
  const khataSales = getKhataSalesForDate(db, ledgerDate);

  const supplierPurchasesTotal = round2(supplierPurchases.reduce((sum, e) => sum + e.line_total, 0));
  const khataSalesTotal = round2(khataSales.reduce((sum, e) => sum + e.line_total, 0));

  const totalIncome = round2(khataSalesTotal + ledger.cash_customer_income);
  const totalExpenses = round2(supplierPurchasesTotal + ledger.extra_expenses);
  const profitLoss = round2(totalIncome - totalExpenses);

  return {
    ...ledger,
    supplier_purchases: supplierPurchases,
    khata_sales: khataSales,
    supplier_purchases_total: supplierPurchasesTotal,
    khata_sales_total: khataSalesTotal,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    profit_loss: profitLoss,
  };
}

/**
 * Updates the two manual fields - Cash Customers Total and Extra Expenses.
 * Each behaves as one single number (spec sections 8 & 12): no breakdown,
 * no sub-records. An empty/omitted field is treated as Rs. 0, not
 * required input (spec section 28).
 */
export function updateDailyLedgerFields(
  db: Database.Database,
  ledgerDate: string,
  cashCustomerIncome: number = 0,
  extraExpenses: number = 0
): DailyLedger {
  assertValidDate(ledgerDate);

  if (!Number.isFinite(cashCustomerIncome) || cashCustomerIncome < 0) {
    throw new Error('Cash Customers Total must be zero or a positive number');
  }
  if (!Number.isFinite(extraExpenses) || extraExpenses < 0) {
    throw new Error('Extra Expenses must be zero or a positive number');
  }

  const existing = db
    .prepare('SELECT * FROM daily_ledgers WHERE ledger_date = ?')
    .get(ledgerDate) as DailyLedger | undefined;
  if (!existing) {
    throw new Error(`No Daily Ledger exists for ${ledgerDate} yet - create it first`);
  }

  db.prepare(
    `UPDATE daily_ledgers
     SET cash_customer_income = ?, extra_expenses = ?, updated_at = datetime('now')
     WHERE ledger_date = ?`
  ).run(round2(cashCustomerIncome), round2(extraExpenses), ledgerDate);

  return db.prepare('SELECT * FROM daily_ledgers WHERE ledger_date = ?').get(ledgerDate) as DailyLedger;
}

/**
 * History list for a date range (inclusive). Each row's totals are
 * derived the same way as getDailyLedger, just without the line-item
 * detail - kept light for a table view covering many days at once.
 */
export function listDailyLedgers(
  db: Database.Database,
  fromDate?: string,
  toDate?: string
): DailyLedgerSummary[] {
  if (fromDate) assertValidDate(fromDate);
  if (toDate) assertValidDate(toDate);

  let query = 'SELECT * FROM daily_ledgers';
  const params: string[] = [];
  const conditions: string[] = [];
  if (fromDate) {
    conditions.push('ledger_date >= ?');
    params.push(fromDate);
  }
  if (toDate) {
    conditions.push('ledger_date <= ?');
    params.push(toDate);
  }
  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY ledger_date DESC';

  const ledgers = db.prepare(query).all(...params) as DailyLedger[];

  return ledgers.map((ledger) => {
    const supplierTotal = round2(
      (
        db
          .prepare(`SELECT COALESCE(SUM(line_total), 0) AS total FROM supplier_entries WHERE date(entry_date) = ?`)
          .get(ledger.ledger_date) as { total: number }
      ).total
    );
    const khataTotal = round2(
      (
        db
          .prepare(`SELECT COALESCE(SUM(line_total), 0) AS total FROM customer_entries WHERE date(entry_date) = ?`)
          .get(ledger.ledger_date) as { total: number }
      ).total
    );
    const totalIncome = round2(khataTotal + ledger.cash_customer_income);
    const totalExpenses = round2(supplierTotal + ledger.extra_expenses);
    return {
      ledger_date: ledger.ledger_date,
      total_income: totalIncome,
      total_expenses: totalExpenses,
      profit_loss: round2(totalIncome - totalExpenses),
    };
  });
}

/**
 * Monthly totals, summed only across dates that actually have a Daily
 * Ledger created - a date with no ledger has no recorded Cash Customers /
 * Extra Expenses figure, so including it would silently understate
 * expenses and overstate profit for that day. month is 1-12.
 */
export function getMonthlySummary(
  db: Database.Database,
  year: number,
  month: number
): { total_income: number; total_expenses: number; total_profit_loss: number } {
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const days = listDailyLedgers(db, `${monthPrefix}-01`, `${monthPrefix}-31`);

  const totalIncome = round2(days.reduce((sum, d) => sum + d.total_income, 0));
  const totalExpenses = round2(days.reduce((sum, d) => sum + d.total_expenses, 0));

  return {
    total_income: totalIncome,
    total_expenses: totalExpenses,
    total_profit_loss: round2(totalIncome - totalExpenses),
  };
}