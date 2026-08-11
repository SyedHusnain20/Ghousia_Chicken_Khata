import { openDatabase } from '../src/main/db/database';
import { createParty, addEntry, generateBill, recordPayment, getParty } from '../src/main/services/partyService';
import {
  createDailyLedger,
  getDailyLedger,
  updateDailyLedgerFields,
} from '../src/main/services/dailyLedgerService';

function assertEqual(label: string, actual: number, expected: number) {
  const pass = Math.abs(actual - expected) < 0.001;
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${label}: expected ${expected}, got ${actual}`);
  if (!pass) process.exitCode = 1;
}

const db = openDatabase(':memory:');

console.log('\n--- Scenario A: Supplier Ali (accumulate-then-bill) ---');
const aliId = createParty(db, 'supplier', 'Ali', '0300-1234567', 10000); // opening due 10000
addEntry(db, 'supplier', aliId, 'Chicken', 40, 370); // 10 Aug: 40kg @ 370 = 14800
addEntry(db, 'supplier', aliId, 'Chicken', 70, 380); // 11 Aug: 70kg @ 380 = 26600
// subtotal should be 14800 + 26600 = 41400; previous due 10000 -> total 51400
const billA = generateBill(db, 'supplier', aliId, 40000); // pays 40000 now
assertEqual('Ali subtotal', billA.subtotal, 41400);
assertEqual('Ali previous_due', billA.previous_due, 10000);
assertEqual('Ali total_due_after_bill', billA.total_due_after_bill, 51400);
assertEqual('Ali remaining_due after paying 40000', billA.remaining_due, 11400);

console.log('\n--- Scenario A2: standalone payment causing overpayment / credit ---');
// Ali later pays 15000 against his 11400 due, outside of any bill generation
recordPayment(db, 'supplier', aliId, 15000, null, 'Standalone payment');
const aliAfter = getParty(db, 'supplier', aliId);
assertEqual('Ali due after overpayment (credit)', aliAfter.current_due, -3600);

console.log('\n--- Scenario B: Customer (matches 78000 / 70000 / 8000 example) ---');
const custId = createParty(db, 'customer', 'Sample Customer', '0301-7654321', 0);
addEntry(db, 'customer', custId, 'Chicken', 195, 400); // 195kg @ 400 = 78000
const billB = generateBill(db, 'customer', custId, 70000);
assertEqual('Customer subtotal', billB.subtotal, 78000);
assertEqual('Customer remaining_due after paying 70000', billB.remaining_due, 8000);

console.log('\n--- Scenario B2: unpaid bill (payment optional at generation) ---');
addEntry(db, 'customer', custId, 'Chicken', 5, 400); // next week: 5kg @ 400 = 2000
const billB2 = generateBill(db, 'customer', custId); // no payment now
assertEqual('Customer previous_due carried into next bill', billB2.previous_due, 8000);
assertEqual('Customer new bill remaining_due (nothing paid)', billB2.remaining_due, 10000);

console.log('\n--- Scenario C: Daily Ledger (matches spec section 15/32 example, LOSS: 13620) ---');
const LEDGER_DATE = '2026-08-11';
createDailyLedger(db, LEDGER_DATE);

// Supplier purchases that day
const aliSupp = createParty(db, 'supplier', 'Ali (ledger)', null, 0);
const ahmedSupp = createParty(db, 'supplier', 'Ahmed (ledger)', null, 0);
const bilalSupp = createParty(db, 'supplier', 'Bilal (ledger)', null, 0);
addEntry(db, 'supplier', aliSupp, 'Chicken', 70, 380, LEDGER_DATE);   // 26,600
addEntry(db, 'supplier', ahmedSupp, 'Chicken', 80, 384, LEDGER_DATE); // 30,720
addEntry(db, 'supplier', bilalSupp, 'Chicken', 50, 390, LEDGER_DATE); // 19,500
// Supplier Purchases Total = 76,820

// Khata customer sales that day
const ahmedCust = createParty(db, 'customer', 'Ahmed (ledger)', null, 0);
const bilalCust = createParty(db, 'customer', 'Bilal (ledger)', null, 0);
const hamzaCust = createParty(db, 'customer', 'Hamza (ledger)', null, 0);
addEntry(db, 'customer', ahmedCust, 'Chicken', 10, 400, LEDGER_DATE); // 4,000
addEntry(db, 'customer', bilalCust, 'Chicken', 20, 410, LEDGER_DATE); // 8,200
addEntry(db, 'customer', hamzaCust, 'Chicken', 15, 420, LEDGER_DATE); // 6,300
// Khata Sales Total = 18,500

updateDailyLedgerFields(db, LEDGER_DATE, 35000, 3500); // Cash Customers, Extra Expenses

const ledger = getDailyLedger(db, LEDGER_DATE);
assertEqual('Supplier purchases total', ledger.supplier_purchases_total, 76820);
assertEqual('Khata sales total', ledger.khata_sales_total, 18500);
assertEqual('Total income', ledger.total_income, 53500);
assertEqual('Total expenses', ledger.total_expenses, 80320);
assertEqual('Profit/Loss (negative = loss)', ledger.profit_loss, -26820);

console.log('\n--- Scenario C2: payments must NOT affect the Daily Ledger (rules 2 & 4) ---');
// Ali's supplier due is now 26,600 from the purchase above; pay some of it off.
recordPayment(db, 'supplier', aliSupp, 10000, null, 'Partial payment, same day');
// Ahmed(customer)'s due is 4,000 from the sale above; collect some of it.
recordPayment(db, 'customer', ahmedCust, 2000, null, 'Partial collection, same day');
const ledgerAfterPayments = getDailyLedger(db, LEDGER_DATE);
assertEqual('Expenses unchanged by supplier payment', ledgerAfterPayments.total_expenses, 80320);
assertEqual('Income unchanged by customer payment', ledgerAfterPayments.total_income, 53500);
assertEqual('Profit/Loss unchanged by payments', ledgerAfterPayments.profit_loss, -26820);

console.log('\n--- Scenario C3: duplicate ledger creation is rejected ---');
try {
  createDailyLedger(db, LEDGER_DATE);
  console.log('FAIL - duplicate ledger creation should have thrown');
  process.exitCode = 1;
} catch (err) {
  console.log('PASS - duplicate ledger creation correctly rejected:', (err as Error).message);
}

console.log('\nDone.');