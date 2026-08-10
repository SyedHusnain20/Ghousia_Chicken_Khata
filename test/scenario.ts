import { openDatabase } from '../src/main/db/database';
import { createParty, addEntry, generateBill, recordPayment, getParty } from '../src/main/services/partyService';

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

console.log('\nDone.');
