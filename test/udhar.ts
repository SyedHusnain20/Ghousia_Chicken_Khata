// Standalone checks for the Daily Ledger "Udhar" feature. Kept separate from
// test/scenario.ts (which still passes a number to generateBill where the
// service now expects an entry-ID array, so it no longer compiles) so this
// one can run on its own:  npx ts-node test/udhar.ts
import { openDatabase } from '../src/main/db/database';
import { createParty, addEntry, recordPayment } from '../src/main/services/partyService';
import {
  createDailyLedger,
  getDailyLedger,
  updateDailyLedgerFields,
  saveDailyLedgerUdhars,
  listDailyLedgers,
  getMonthlySummary,
} from '../src/main/services/dailyLedgerService';

function assertEqual(label: string, actual: number, expected: number) {
  const pass = Math.abs(actual - expected) < 0.001;
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${label}: expected ${expected}, got ${actual}`);
  if (!pass) process.exitCode = 1;
}

function assertRejects(label: string, fn: () => void) {
  try {
    fn();
    console.log(`FAIL - ${label} should have thrown`);
    process.exitCode = 1;
  } catch (err) {
    console.log(`PASS - ${label} rejected: ${(err as Error).message}`);
  }
}

const db = openDatabase(':memory:');
const DATE = '2026-08-11';
createDailyLedger(db, DATE);

// Same figures as the existing Daily Ledger scenario: supplier purchases
// 76,820, Khata sales 18,500, Sale 35,000, Extra Expenses 3,500, Items Left 7,200.
const ali = createParty(db, 'supplier', 'Ali', null, 0);
const ahmed = createParty(db, 'supplier', 'Ahmed', null, 0);
const bilal = createParty(db, 'supplier', 'Bilal', null, 0);
addEntry(db, 'supplier', ali, 'Chicken', 70, 380, DATE);
addEntry(db, 'supplier', ahmed, 'Chicken', 80, 384, DATE);
addEntry(db, 'supplier', bilal, 'Chicken', 50, 390, DATE);
const c1 = createParty(db, 'customer', 'Ahmed (cust)', null, 0);
const c2 = createParty(db, 'customer', 'Bilal (cust)', null, 0);
const c3 = createParty(db, 'customer', 'Hamza (cust)', null, 0);
addEntry(db, 'customer', c1, 'Chicken', 10, 400, DATE);
addEntry(db, 'customer', c2, 'Chicken', 20, 410, DATE);
addEntry(db, 'customer', c3, 'Chicken', 15, 420, DATE);
updateDailyLedgerFields(db, DATE, { saleIncome: 35000, extraExpenses: 3500 });
updateDailyLedgerFields(db, DATE, {
  liveChicken: { weightKg: 10, rate: 300 },
  chickenMeat: { weightKg: 5, rate: 600, totalAmount: 3200 },
  lever: { weightKg: 2, rate: 500 },
});

console.log('\n--- Before any Udhar: behaves exactly as before ---');
const before = getDailyLedger(db, DATE);
assertEqual('No Udhar rows yet', before.udhars.length, 0);
assertEqual('Udhar total is 0', before.udhar_total, 0);
assertEqual('Total income (Khata + Sale + Items Left)', before.total_income, 60700);

console.log('\n--- Udhar rows add to Total Income ---');
saveDailyLedgerUdhars(db, DATE, [
  { name: 'Usman', amount: 5000 },
  { name: 'Zain', amount: 2500 },
  { name: 'Bashir', amount: 1500 },
]);
const withUdhar = getDailyLedger(db, DATE);
assertEqual('Udhar row count', withUdhar.udhars.length, 3);
assertEqual('Udhar total', withUdhar.udhar_total, 9000);
assertEqual('Total income = Khata + Sale + Items Left + Udhar', withUdhar.total_income, 69700);
assertEqual('Total expenses unaffected', withUdhar.total_expenses, 80320);
assertEqual('Profit/Loss reflects Udhar', withUdhar.profit_loss, -10620);
assertEqual('Sale unchanged', withUdhar.sale_income, 35000);
assertEqual('Items Left unchanged', withUdhar.items_left_total, 7200);

console.log('\n--- History list and monthly summary include Udhar ---');
const hist = listDailyLedgers(db, DATE, DATE)[0];
assertEqual('History total income', hist.total_income, 69700);
assertEqual('History profit/loss', hist.profit_loss, -10620);
assertEqual('Monthly total income', getMonthlySummary(db, 2026, 8).total_income, 69700);

console.log('\n--- Saving replaces the whole set, trims names, floors amounts ---');
saveDailyLedgerUdhars(db, DATE, [{ name: '  Usman  ', amount: 5000.9 }]);
const replaced = getDailyLedger(db, DATE);
assertEqual('Replaced, not appended', replaced.udhars.length, 1);
assertEqual('Amount floored to whole rupees', replaced.udhar_total, 5000);
assertEqual('Name trimmed (1 = yes)', replaced.udhars[0].name === 'Usman' ? 1 : 0, 1);

console.log('\n--- Other saves and payments do not touch Udhar ---');
updateDailyLedgerFields(db, DATE, { saleIncome: 36000 });
assertEqual('Udhar survives a Sale/Expenses save', getDailyLedger(db, DATE).udhar_total, 5000);
updateDailyLedgerFields(db, DATE, { liveChicken: { weightKg: 10, rate: 300 } });
assertEqual('Udhar survives an Items Left save', getDailyLedger(db, DATE).udhar_total, 5000);
recordPayment(db, 'customer', c1, 2000, null, 'collection');
assertEqual('Udhar unaffected by a customer payment', getDailyLedger(db, DATE).udhar_total, 5000);

console.log('\n--- Empty list clears the day ---');
saveDailyLedgerUdhars(db, DATE, []);
assertEqual('Udhar cleared', getDailyLedger(db, DATE).udhar_total, 0);

console.log('\n--- Validation ---');
assertRejects('blank name', () => saveDailyLedgerUdhars(db, DATE, [{ name: '   ', amount: 100 }]));
assertRejects('zero amount', () => saveDailyLedgerUdhars(db, DATE, [{ name: 'Ali', amount: 0 }]));
assertRejects('amount under Rs. 1', () => saveDailyLedgerUdhars(db, DATE, [{ name: 'Ali', amount: 0.5 }]));
assertRejects('negative amount', () => saveDailyLedgerUdhars(db, DATE, [{ name: 'Ali', amount: -50 }]));
assertRejects('NaN amount', () => saveDailyLedgerUdhars(db, DATE, [{ name: 'Ali', amount: NaN }]));
assertRejects('date with no ledger', () => saveDailyLedgerUdhars(db, '2030-01-01', [{ name: 'Ali', amount: 100 }]));
assertRejects('bad date format', () => saveDailyLedgerUdhars(db, '11-08-2026', [{ name: 'Ali', amount: 100 }]));

console.log('\n--- A rejected save leaves the earlier rows intact ---');
saveDailyLedgerUdhars(db, DATE, [{ name: 'Keep me', amount: 700 }]);
assertRejects('one good row + one bad row', () =>
  saveDailyLedgerUdhars(db, DATE, [
    { name: 'New', amount: 100 },
    { name: '', amount: 100 },
  ])
);
assertEqual('Earlier Udhar intact', getDailyLedger(db, DATE).udhar_total, 700);

console.log('\n--- Existing database (created before this feature) picks up the table ---');
// openDatabase() runs schema.sql on every start, and the new table is
// CREATE TABLE IF NOT EXISTS, so an existing khata.db gains it automatically.
const tableCount = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'daily_ledger_udhars'").get() as { n: number }).n;
assertEqual('daily_ledger_udhars table exists', tableCount, 1);

console.log('\nDone.');
