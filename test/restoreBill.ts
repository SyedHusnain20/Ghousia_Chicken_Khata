import { openDatabase } from '../src/main/db/database';
import {
  createParty,
  getParty,
  addEntry,
  updateEntry,
  deleteEntry,
  recordPayment,
  generateBill,
  restoreBill,
  getBillById,
  getBillsForParty,
  getUnbilledEntries,
  getUnbilledPayments,
  getPayments,
} from '../src/main/services/partyService';
import { createDailyLedger, getDailyLedger } from '../src/main/services/dailyLedgerService';
import type { PartyType } from '../src/main/types';

function check(label: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${label}${pass ? '' : detail ? ` (${detail})` : ''}`);
  if (!pass) process.exitCode = 1;
}
function eq<T>(label: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, `expected ${e}, got ${a}`);
}
function throws(label: string, fn: () => unknown, messagePart: string) {
  try {
    fn();
    check(label, false, 'did not throw');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(label, msg.includes(messagePart), `threw "${msg}"`);
  }
}

// Just the fields that must survive a restore untouched.
const entryShape = (e: any) => ({
  id: e.id, entry_date: e.entry_date, item_name: e.item_name,
  weight_kg: e.weight_kg, rate_per_kg: e.rate_per_kg, line_total: e.line_total,
});
const paymentShape = (p: any) => ({
  id: p.id, amount: p.amount, payment_method: p.payment_method, paid_at: p.paid_at, note: p.note,
});

const db = openDatabase(':memory:');

for (const partyType of ['supplier', 'customer', 'shopkeeper'] as PartyType[]) {
  console.log(`\n--- ${partyType}: bill -> restore -> edit -> re-bill ---`);
  const id = createParty(db, partyType, `Test ${partyType}`, null, 5000);

  // Three entries on different, deliberately back-dated days, two payments on other days.
  addEntry(db, partyType, id, 'Chicken', 40, 370, '2026-08-01'); // 14800
  addEntry(db, partyType, id, 'Chicken', 70, 380, '2026-08-03'); // 26600
  addEntry(db, partyType, id, 'Lever', 5, 900, '2026-08-05');    // 4500
  recordPayment(db, partyType, id, 10000, null, 'first', 'cash', '2026-08-02');
  recordPayment(db, partyType, id, 2500, null, 'second', 'online', '2026-08-06');

  const dueBeforeBill = getParty(db, partyType, id).current_due; // 5000+45900-12500 = 38400
  eq('due before billing', dueBeforeBill, 38400);

  const entriesBefore = getUnbilledEntries(db, partyType, id).map(entryShape);
  const paymentsBefore = getUnbilledPayments(db, partyType, id).map(paymentShape);
  eq('3 unbilled entries + 2 unbilled payments before billing', [entriesBefore.length, paymentsBefore.length], [3, 2]);

  const bill = generateBill(db, partyType, id);
  eq('nothing unbilled after billing', [getUnbilledEntries(db, partyType, id).length, getUnbilledPayments(db, partyType, id).length], [0, 0]);
  eq('due unchanged by billing', getParty(db, partyType, id).current_due, dueBeforeBill);

  const result = restoreBill(db, partyType, bill.id);
  eq('restore reports counts and party', [result.entriesRestored, result.paymentsRestored, result.partyId], [3, 2, id]);
  throws('bill is deleted', () => getBillById(db, partyType, bill.id), 'not found');
  eq('bill history is empty', getBillsForParty(db, partyType, id).length, 0);
  eq('entries restored with exact original dates/amounts', getUnbilledEntries(db, partyType, id).map(entryShape), entriesBefore);
  eq('payments restored with exact original dates/amounts', getUnbilledPayments(db, partyType, id).map(paymentShape), paymentsBefore);
  eq('due unchanged by restore', getParty(db, partyType, id).current_due, dueBeforeBill);
  eq('no payment still points at the deleted bill', getPayments(db, partyType, id).filter((p) => p.bill_id !== null).length, 0);

  throws('restoring the same bill twice fails cleanly', () => restoreBill(db, partyType, bill.id), 'not found');
  eq('...and changes nothing', getUnbilledEntries(db, partyType, id).map(entryShape), entriesBefore);

  // Re-billing with no edits reproduces the original bill's numbers.
  const rebill = generateBill(db, partyType, id);
  eq('re-bill (no edits) has the same figures',
    [rebill.previous_due, rebill.subtotal, rebill.total_due_after_bill, rebill.remaining_due],
    [bill.previous_due, bill.subtotal, bill.total_due_after_bill, bill.remaining_due]);
  restoreBill(db, partyType, rebill.id);

  // The point of the feature: restored entries can be edited / deleted again.
  const [first, second] = getUnbilledEntries(db, partyType, id);
  updateEntry(db, partyType, id, first.id, 'Chicken', 40, 375, '2026-08-01'); // 15000 (+200)
  deleteEntry(db, partyType, id, second.id);                                   // -26600
  eq('due follows the edit and the delete', getParty(db, partyType, id).current_due, 38400 + 200 - 26600);
  const fixed = generateBill(db, partyType, id);
  eq('corrected bill reflects the edit and delete', [fixed.items.length, fixed.subtotal], [2, 19500]);
  eq('corrected bill previous_due is still the pre-bill balance', fixed.previous_due, bill.previous_due);
  eq('payments carried onto corrected bill', fixed.payments.map(paymentShape), paymentsBefore);
}

console.log('\n--- Partial bill: only the billed entries are restored, the rest are left alone ---');
{
  const id = createParty(db, 'customer', 'Partial', null, 0);
  const e1 = addEntry(db, 'customer', id, 'Chicken', 10, 400, '2026-08-10');
  const e2 = addEntry(db, 'customer', id, 'Chicken', 20, 400, '2026-08-11');
  addEntry(db, 'customer', id, 'Chicken', 30, 400, '2026-08-12');
  const bill = generateBill(db, 'customer', id, [e1, e2], []);
  eq('one entry left unbilled', getUnbilledEntries(db, 'customer', id).length, 1);
  const due = getParty(db, 'customer', id).current_due;
  const r = restoreBill(db, 'customer', bill.id);
  eq('only the 2 billed entries reported', r.entriesRestored, 2);
  eq('all 3 unbilled again', getUnbilledEntries(db, 'customer', id).length, 3);
  eq('due unchanged', getParty(db, 'customer', id).current_due, due);
}

console.log('\n--- Payment-only bill (no entries) ---');
{
  const id = createParty(db, 'supplier', 'PayOnly', null, 1000);
  recordPayment(db, 'supplier', id, 400, null, null, 'cash', '2026-08-09');
  const bill = generateBill(db, 'supplier', id);
  const r = restoreBill(db, 'supplier', bill.id);
  eq('0 entries, 1 payment restored', [r.entriesRestored, r.paymentsRestored], [0, 1]);
  eq('payment is unbilled again with its date', getUnbilledPayments(db, 'supplier', id).map((p) => p.paid_at.split(' ')[0]), ['2026-08-09']);
}

console.log('\n--- Bill ids are per-table: restoring customer bill #N must not touch supplier bill #N ---');
{
  const s = createParty(db, 'supplier', 'Isolation S', null, 0);
  const c = createParty(db, 'customer', 'Isolation C', null, 0);
  addEntry(db, 'supplier', s, 'Chicken', 10, 100, '2026-08-20');
  recordPayment(db, 'supplier', s, 50, null, null, 'cash', '2026-08-20');
  addEntry(db, 'customer', c, 'Chicken', 10, 100, '2026-08-20');
  recordPayment(db, 'customer', c, 50, null, null, 'cash', '2026-08-20');
  const sb = generateBill(db, 'supplier', s);
  // Force a customer bill that has the very same numeric id as the supplier one.
  let cb = generateBill(db, 'customer', c);
  while (cb.id < sb.id) {
    restoreBill(db, 'customer', cb.id);
    cb = generateBill(db, 'customer', c);
  }
  const numericIdsCollide = cb.id === sb.id;
  if (numericIdsCollide) {
    restoreBill(db, 'customer', cb.id);
    eq('supplier bill still exists', getBillById(db, 'supplier', sb.id).items.length, 1);
    eq('supplier payment still attached to its bill', getBillById(db, 'supplier', sb.id).payments.length, 1);
    eq('customer payment was released', getUnbilledPayments(db, 'customer', c).length, 1);
  } else {
    console.log('SKIP - could not line up equal bill ids in this run');
  }
}

console.log('\n--- Daily Ledger is unaffected (it reads entries by date) ---');
{
  const DATE = '2026-09-01';
  const id = createParty(db, 'supplier', 'Ledger S', null, 0);
  createDailyLedger(db, DATE);
  addEntry(db, 'supplier', id, 'Chicken', 10, 300, DATE);
  const before = getDailyLedger(db, DATE).supplier_purchases_total;
  const bill = generateBill(db, 'supplier', id);
  restoreBill(db, 'supplier', bill.id);
  eq('purchases total unchanged by bill + restore', getDailyLedger(db, DATE).supplier_purchases_total, before);
}

console.log(process.exitCode ? '\nSome checks FAILED.' : '\nAll restore-bill checks passed.');
