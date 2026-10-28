// Checks for the "Waste Customers" party type:
//  - they behave exactly like customers (profile, due, entries, payments, bills)
//  - they appear on the Daily Ledger with their OWN total
//  - that total is NEVER part of income / expenses / profit-loss (daily or monthly)
//  - an existing database (created before waste customers existed) upgrades safely
// Run:  npx ts-node test/wasteCustomers.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDatabase } from '../src/main/db/database';
import {
  createParty,
  getParty,
  getAllParties,
  getAllPartiesWithActivity,
  addEntry,
  recordPayment,
  generateBill,
  restoreBill,
  deleteParty,
} from '../src/main/services/partyService';
import { listAllBills } from '../src/main/services/billService';
import {
  createDailyLedger,
  getDailyLedger,
  updateDailyLedgerFields,
  listDailyLedgers,
  getMonthlySummary,
} from '../src/main/services/dailyLedgerService';

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}${detail ? ': ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}
function eq(label: string, actual: unknown, expected: unknown) {
  check(label, actual === expected, `expected ${expected}, got ${actual}`);
}

const db = openDatabase(':memory:');
const DATE = '2026-10-27';

// ---- 1. Behaves like a customer ------------------------------------------
console.log('--- Waste customer behaves like a customer ---');
const ahmed = createParty(db, 'waste_customer', 'Ahmed Waste', '0300-1234567', 1000);
let party = getParty(db, 'waste_customer', ahmed);
eq('name stored', party.name, 'Ahmed Waste');
eq('contact number stored', party.contact_number, '0300-1234567');
eq('previous (opening) due stored', party.opening_due, 1000);
eq('current due starts at opening due', party.current_due, 1000);

addEntry(db, 'waste_customer', ahmed, 'Waste', 10, 50, DATE); // 500
party = getParty(db, 'waste_customer', ahmed);
eq('sale adds to due (1000 + 500)', party.current_due, 1500);

recordPayment(db, 'waste_customer', ahmed, 300, null, null, 'cash', DATE);
eq('payment reduces due', getParty(db, 'waste_customer', ahmed).current_due, 1200);

const bill = generateBill(db, 'waste_customer', ahmed);
eq('bill subtotal is the sale total', bill.subtotal, 500);
const billList = listAllBills(db, {});
check('bill appears in the global Bills list as waste_customer', billList.some((b) => b.party_type === 'waste_customer' && b.id === bill.id));
eq('Bills filter by waste_customer works', listAllBills(db, { partyType: 'waste_customer' }).length, 1);
eq('Bills filter for customers does not include it', listAllBills(db, { partyType: 'customer' }).length, 0);
const restored = restoreBill(db, 'waste_customer', bill.id);
eq('restoring the bill puts the entry back', restored.entriesRestored, 1);

// ---- 2. Kept separate from Khata customers --------------------------------
console.log('\n--- Kept separate from Khata customers ---');
const shan = createParty(db, 'customer', 'Shan', null, 0);
check('customers list does not contain waste customers', !getAllParties(db, 'customer').some((p) => p.name === 'Ahmed Waste'));
check('waste list does not contain customers', !getAllParties(db, 'waste_customer').some((p) => p.name === 'Shan'));
const withActivity = getAllPartiesWithActivity(db, 'waste_customer');
check('recent-purchase info works for waste customers', withActivity.length === 1 && withActivity[0].last_purchase_date !== null);

// ---- 3. Daily Ledger: own total, excluded from profit/loss ----------------
console.log('\n--- Daily Ledger: waste has its own total, outside profit/loss ---');
const ali = createParty(db, 'supplier', 'Ali', null, 0);
createDailyLedger(db, DATE);
addEntry(db, 'supplier', ali, 'Chicken', 100, 300, DATE); // expense 30,000
addEntry(db, 'customer', shan, 'Chicken', 50, 400, DATE); // income 20,000
updateDailyLedgerFields(db, DATE, { saleIncome: 5000, extraExpenses: 1000 });

const before = getDailyLedger(db, DATE);
const incomeBefore = before.total_income;
const expensesBefore = before.total_expenses;
const profitBefore = before.profit_loss;
eq("Ahmed's Rs. 500 sale (added in section 1) already shows as waste", before.waste_sales_total, 500);

// A second waste customer with two more sales on the same day.
const fatima = createParty(db, 'waste_customer', 'Fatima Waste', null, 0);
addEntry(db, 'waste_customer', fatima, 'Waste', 40, 25, DATE); // 1,000
addEntry(db, 'waste_customer', fatima, 'Waste', 8.5, 40, DATE); // 340
const after = getDailyLedger(db, DATE);

eq('waste total = Ahmed 500 + Fatima 1,000 + 340', after.waste_sales_total, 1840);
eq('waste rows listed (3 sales)', after.waste_sales.length, 3);
check('waste rows are tagged waste_customer', after.waste_sales.every((r) => r.party_type === 'waste_customer'));
eq('Khata sales total is unaffected', after.khata_sales_total, 20000);
check('Khata sales list contains no waste rows', after.khata_sales.every((r) => r.party_type === 'customer'));
eq('Total Income unchanged by waste', after.total_income, incomeBefore);
eq('Total Expenses unchanged by waste', after.total_expenses, expensesBefore);
eq('Profit/Loss unchanged by waste', after.profit_loss, profitBefore);
eq('Profit/Loss is what it should be: (20000+5000) - (30000+1000)', after.profit_loss, -6000);

// A waste sale on a different day must not appear on this day.
addEntry(db, 'waste_customer', fatima, 'Waste', 1, 100, '2026-10-26');
eq('other-day waste sale is not on this ledger', getDailyLedger(db, DATE).waste_sales_total, 1840);

// ---- 4. History + monthly summary -----------------------------------------
console.log('\n--- History and monthly summary ---');
createDailyLedger(db, '2026-10-26'); // has a waste sale of 100 and nothing else
const history = listDailyLedgers(db, '2026-10-01', '2026-10-31');
const day = history.find((d) => d.ledger_date === DATE)!;
eq('history row: waste_total', day.waste_total, 1840);
eq('history row: profit/loss ignores waste', day.profit_loss, -6000);
const prev = history.find((d) => d.ledger_date === '2026-10-26')!;
eq('other day: waste_total', prev.waste_total, 100);
eq('other day: income has no waste in it', prev.total_income, 0);
eq('other day: profit/loss has no waste in it', prev.profit_loss, 0);

const month = getMonthlySummary(db, 2026, 10);
eq('monthly waste total = 1840 + 100', month.total_waste, 1940);
eq('monthly income ignores waste', month.total_income, 25000);
eq('monthly expenses ignores waste', month.total_expenses, 31000);
eq('monthly profit/loss ignores waste', month.total_profit_loss, -6000);

// ---- 5. Delete rules work the same -----------------------------------------
console.log('\n--- Delete rules ---');
const mistake = createParty(db, 'waste_customer', 'Entered By Mistake', null, 0);
deleteParty(db, 'waste_customer', mistake);
check('a brand-new waste customer with no history can be deleted', !getAllParties(db, 'waste_customer').some((p) => p.id === mistake));
let blocked = false;
try { deleteParty(db, 'waste_customer', fatima); } catch { blocked = true; }
check('a waste customer with history can NOT be deleted', blocked);

// ---- 6. Existing database upgrades safely -----------------------------------
console.log('\n--- An existing (pre-waste) database upgrades safely ---');
const tmp = path.join(os.tmpdir(), `khata-upgrade-${Date.now()}.db`);
const oldDb = openDatabase(tmp);
const oldCustomer = createParty(oldDb, 'customer', 'Old Customer', null, 700);
addEntry(oldDb, 'customer', oldCustomer, 'Chicken', 10, 300, DATE);
// Make it look like a database from before this feature existed.
oldDb.exec('DROP INDEX idx_waste_customer_entries_unbilled; DROP INDEX idx_waste_customer_entries_date;');
oldDb.exec('DROP TABLE waste_customer_entries; DROP TABLE waste_customer_bills; DROP TABLE waste_customers;');
oldDb.close();

const upgraded = openDatabase(tmp);
eq('existing customer data is untouched', getParty(upgraded, 'customer', oldCustomer).current_due, 3700);
const newWaste = createParty(upgraded, 'waste_customer', 'New Waste', null, 0);
addEntry(upgraded, 'waste_customer', newWaste, 'Waste', 2, 100, DATE);
eq('waste customers work right after the upgrade', getParty(upgraded, 'waste_customer', newWaste).current_due, 200);
upgraded.close();
fs.rmSync(tmp, { force: true });

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nAll waste customer checks passed.');
