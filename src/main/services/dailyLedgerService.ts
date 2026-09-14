import Database from 'better-sqlite3';
import { DailyLedger, DailyLedgerDetail, DailyLedgerSummary, EntryWithPartyName } from '../types';
import { floorMoney, DATE_ONLY_RE, pakistanNow } from './partyService';

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
 * Supplier AND shopkeeper purchases for one date, with the party's name
 * attached - shopkeepers behave exactly like suppliers (spec: money the
 * shop owes for purchases), so their purchases are an expense here just
 * the same and must be included, or Total Expenses would silently
 * understate whenever a shopkeeper purchase happened that day.
 * Rule 1/2 (spec section 31): a purchase is the expense; a payment
 * against the due is NOT included here at all - payments live only in
 * the `payments` table and never touch entry_date-based queries.
 */
function getSupplierPurchasesForDate(db: Database.Database, date: string): EntryWithPartyName[] {
  return db
    .prepare(
      `SELECT se.*, 'supplier' AS party_type, se.supplier_id AS party_id, s.name AS party_name
       FROM supplier_entries se
       JOIN suppliers s ON s.id = se.supplier_id
       WHERE date(se.entry_date) = ?
       UNION ALL
       SELECT ke.*, 'shopkeeper' AS party_type, ke.shopkeeper_id AS party_id, k.name AS party_name
       FROM shopkeeper_entries ke
       JOIN shopkeepers k ON k.id = ke.shopkeeper_id
       WHERE date(ke.entry_date) = ?
       ORDER BY entry_date`
    )
    .all(date, date) as EntryWithPartyName[];
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
      `SELECT ce.*, 'customer' AS party_type, ce.customer_id AS party_id, c.name AS party_name
       FROM customer_entries ce
       JOIN customers c ON c.id = ce.customer_id
       WHERE date(ce.entry_date) = ?
       ORDER BY ce.entry_date`
    )
    .all(date) as EntryWithPartyName[];
}

/**
 * Sum of the three Items Left totals - unsold Live Chicken, Chicken Meat,
 * and Lever. Derived from the stored per-item totals rather than stored
 * itself, so it can never drift out of sync with them.
 */
function itemsLeftTotal(ledger: DailyLedger): number {
  return floorMoney(ledger.live_chicken_total + ledger.chicken_meat_total + ledger.lever_total);
}

/**
 * The full Daily Ledger view for one date. Throws if no ledger has been
 * created for that date yet (see createDailyLedger). Every total here is
 * computed fresh from supplier_entries/customer_entries (or, for Items
 * Left, from the ledger's own stored item fields) - nothing about supplier
 * or Khata activity is read from or written to daily_ledgers.
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

  const supplierPurchasesTotal = floorMoney(supplierPurchases.reduce((sum, e) => sum + e.line_total, 0));
  const khataSalesTotal = floorMoney(khataSales.reduce((sum, e) => sum + e.line_total, 0));
  const itemsLeft = itemsLeftTotal(ledger);

  // Profit/Loss = (Khata sales + Sale + Items Left) - (Extra Expenses + Supplier Purchases)
  const totalIncome = floorMoney(khataSalesTotal + ledger.sale_income + itemsLeft);
  const totalExpenses = floorMoney(supplierPurchasesTotal + ledger.extra_expenses);
  const profitLoss = floorMoney(totalIncome - totalExpenses);

  return {
    ...ledger,
    supplier_purchases: supplierPurchases,
    khata_sales: khataSales,
    supplier_purchases_total: supplierPurchasesTotal,
    khata_sales_total: khataSalesTotal,
    items_left_total: itemsLeft,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    profit_loss: profitLoss,
  };
}

/** One Items Left row's editable input - weight and rate, plus an optional override total. */
export interface DailyLedgerItemInput {
  weightKg?: number;
  rate?: number;
  totalAmount?: number; // omit/blank to auto-calculate as floor(weightKg * rate)
}

export interface UpdateDailyLedgerFieldsInput {
  saleIncome?: number;
  extraExpenses?: number;
  liveChicken?: DailyLedgerItemInput;
  chickenMeat?: DailyLedgerItemInput;
  lever?: DailyLedgerItemInput;
}

function validateNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be zero or a positive number`);
  }
}

/**
 * Resolves one Items Left row against its previously stored values. Only
 * touches this item at all if the caller actually supplied something for
 * it (see updateDailyLedgerFields) - otherwise the item's stored weight/
 * rate/total pass straight through unchanged. When touched, a missing
 * weight or rate within that item defaults to 0 (mirrors the "blank = 0"
 * rule already used for Extra Expenses/Sale); a missing total is computed
 * as floor(weight * rate) rather than defaulted to 0, since the total is
 * explicitly optional (spec: "total amount (optional)").
 */
function resolveItem(
  input: DailyLedgerItemInput | undefined,
  existingWeight: number,
  existingRate: number,
  existingTotal: number,
  label: string
): { weightKg: number; rate: number; total: number } {
  if (!input) {
    return { weightKg: existingWeight, rate: existingRate, total: existingTotal };
  }
  const weightKg = input.weightKg ?? 0;
  const rate = input.rate ?? 0;
  validateNonNegative(weightKg, `${label} weight`);
  validateNonNegative(rate, `${label} rate`);
  let total: number;
  if (input.totalAmount !== undefined) {
    validateNonNegative(input.totalAmount, `${label} total amount`);
    total = floorMoney(input.totalAmount);
  } else {
    total = floorMoney(weightKg * rate);
  }
  return { weightKg, rate, total };
}

/**
 * Updates the manual fields: Sale, Extra Expenses, and the Items Left
 * breakdown (Live Chicken / Chicken Meat / Lever). These are saved from two
 * independent forms in the UI, so each group here is only touched when the
 * caller actually supplies something for it - an omitted group keeps its
 * previously stored values rather than being reset to 0, and an omitted
 * field *within* a supplied group defaults to 0 (spec section 28, extended
 * to Items Left).
 */
export function updateDailyLedgerFields(
  db: Database.Database,
  ledgerDate: string,
  input: UpdateDailyLedgerFieldsInput = {}
): DailyLedger {
  assertValidDate(ledgerDate);

  const existing = db
    .prepare('SELECT * FROM daily_ledgers WHERE ledger_date = ?')
    .get(ledgerDate) as DailyLedger | undefined;
  if (!existing) {
    throw new Error(`No Daily Ledger exists for ${ledgerDate} yet - create it first`);
  }

  const saleIncome = input.saleIncome !== undefined ? input.saleIncome : existing.sale_income;
  const extraExpenses = input.extraExpenses !== undefined ? input.extraExpenses : existing.extra_expenses;
  validateNonNegative(saleIncome, 'Sale');
  validateNonNegative(extraExpenses, 'Extra Expenses');

  const liveChicken = resolveItem(
    input.liveChicken,
    existing.live_chicken_weight_kg,
    existing.live_chicken_rate,
    existing.live_chicken_total,
    'Live Chicken'
  );
  const chickenMeat = resolveItem(
    input.chickenMeat,
    existing.chicken_meat_weight_kg,
    existing.chicken_meat_rate,
    existing.chicken_meat_total,
    'Chicken Meat'
  );
  const lever = resolveItem(input.lever, existing.lever_weight_kg, existing.lever_rate, existing.lever_total, 'Lever');

  const updatedAt = `${pakistanNow().date} ${pakistanNow().time}`;
  db.prepare(
    `UPDATE daily_ledgers
     SET sale_income = ?, extra_expenses = ?,
         live_chicken_weight_kg = ?, live_chicken_rate = ?, live_chicken_total = ?,
         chicken_meat_weight_kg = ?, chicken_meat_rate = ?, chicken_meat_total = ?,
         lever_weight_kg = ?, lever_rate = ?, lever_total = ?,
         updated_at = ?
     WHERE ledger_date = ?`
  ).run(
    floorMoney(saleIncome),
    floorMoney(extraExpenses),
    liveChicken.weightKg,
    liveChicken.rate,
    liveChicken.total,
    chickenMeat.weightKg,
    chickenMeat.rate,
    chickenMeat.total,
    lever.weightKg,
    lever.rate,
    lever.total,
    updatedAt,
    ledgerDate
  );

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
    const supplierTotal = floorMoney(
      (
        db
          .prepare(
            `SELECT
               COALESCE((SELECT SUM(line_total) FROM supplier_entries WHERE date(entry_date) = ?), 0) +
               COALESCE((SELECT SUM(line_total) FROM shopkeeper_entries WHERE date(entry_date) = ?), 0)
             AS total`
          )
          .get(ledger.ledger_date, ledger.ledger_date) as { total: number }
      ).total
    );
    const khataTotal = floorMoney(
      (
        db
          .prepare(`SELECT COALESCE(SUM(line_total), 0) AS total FROM customer_entries WHERE date(entry_date) = ?`)
          .get(ledger.ledger_date) as { total: number }
      ).total
    );
    const totalIncome = floorMoney(khataTotal + ledger.sale_income + itemsLeftTotal(ledger));
    const totalExpenses = floorMoney(supplierTotal + ledger.extra_expenses);
    return {
      ledger_date: ledger.ledger_date,
      total_income: totalIncome,
      total_expenses: totalExpenses,
      profit_loss: floorMoney(totalIncome - totalExpenses),
    };
  });
}

/**
 * Monthly totals, summed only across dates that actually have a Daily
 * Ledger created - a date with no ledger has no recorded Sale / Extra
 * Expenses / Items Left figure, so including it would silently understate
 * expenses and overstate profit for that day. month is 1-12.
 */
export function getMonthlySummary(
  db: Database.Database,
  year: number,
  month: number
): { total_income: number; total_expenses: number; total_profit_loss: number } {
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const days = listDailyLedgers(db, `${monthPrefix}-01`, `${monthPrefix}-31`);

  const totalIncome = floorMoney(days.reduce((sum, d) => sum + d.total_income, 0));
  const totalExpenses = floorMoney(days.reduce((sum, d) => sum + d.total_expenses, 0));

  return {
    total_income: totalIncome,
    total_expenses: totalExpenses,
    total_profit_loss: floorMoney(totalIncome - totalExpenses),
  };
}