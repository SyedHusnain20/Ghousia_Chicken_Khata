import { openDatabase } from '../src/main/db/database';
import {
  createParty,
  getParty,
  addEntry,
  recordPayment,
  updatePayment,
  deletePayment,
  generateBill,
  restoreBill,
  getUnbilledPayments,
  getPayments,
} from '../src/main/services/partyService';
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

const db = openDatabase(':memory:');

for (const partyType of ['supplier', 'customer', 'shopkeeper'] as PartyType[]) {
  console.log(`\n--- ${partyType}: edit / delete unbilled payments ---`);
  const id = createParty(db, partyType, `Pay ${partyType}`, null, 1000);
  addEntry(db, partyType, id, 'Chicken', 10, 100, '2026-08-01'); // 1000
  const a = recordPayment(db, partyType, id, 300, null, 'Standalone payment', 'cash', '2026-08-01');
  const b = recordPayment(db, partyType, id, 200, null, 'Standalone payment', 'online', '2026-08-02');
  eq('due before edits (1000 + 1000 - 500)', getParty(db, partyType, id).current_due, 1500);
  const timeOfA = a.paid_at.split(' ')[1];

  // --- edit ---
  updatePayment(db, partyType, id, a.id, 450, 'online', '2026-07-30');
  const editedA = getPayments(db, partyType, id).find((p) => p.id === a.id)!;
  eq('amount, method, date updated', [editedA.amount, editedA.payment_method, editedA.paid_at.split(' ')[0]], [450, 'online', '2026-07-30']);
  eq('original time-of-day preserved', editedA.paid_at.split(' ')[1], timeOfA);
  eq('note and bill link untouched', [editedA.note, editedA.bill_id], ['Standalone payment', null]);
  eq('due follows the edit (1500 + 300 - 450)', getParty(db, partyType, id).current_due, 1350);
  eq('still unbilled, same id, no duplicate rows', getUnbilledPayments(db, partyType, id).map((p) => p.id).sort(), [a.id, b.id].sort());

  updatePayment(db, partyType, id, a.id, 100, 'online');
  eq('lowering the amount raises the due (1350 + 450 - 100)', getParty(db, partyType, id).current_due, 1700);
  updatePayment(db, partyType, id, a.id, 99.9, 'cash');
  eq('decimals are floored to whole rupees like everywhere else', getPayments(db, partyType, id).find((p) => p.id === a.id)!.amount, 99);
  eq('due matches (1700 + 100 - 99)', getParty(db, partyType, id).current_due, 1701);
  eq('omitting the date leaves the date alone', getPayments(db, partyType, id).find((p) => p.id === a.id)!.paid_at.split(' ')[0], '2026-07-30');

  // --- bad input changes nothing ---
  const dueNow = getParty(db, partyType, id).current_due;
  throws('zero amount rejected', () => updatePayment(db, partyType, id, a.id, 0, 'cash'), 'greater than zero');
  throws('negative amount rejected', () => updatePayment(db, partyType, id, a.id, -5, 'cash'), 'greater than zero');
  throws('NaN rejected', () => updatePayment(db, partyType, id, a.id, NaN, 'cash'), 'greater than zero');
  throws('0.5 (floors to 0) rejected', () => updatePayment(db, partyType, id, a.id, 0.5, 'cash'), 'at least Rs. 1');
  throws('bad date rejected', () => updatePayment(db, partyType, id, a.id, 50, 'cash', '30-07-2026'), 'YYYY-MM-DD');
  throws('bad method rejected', () => updatePayment(db, partyType, id, a.id, 50, 'cheque' as any), 'cash');
  eq('due unchanged after all the rejected edits', getParty(db, partyType, id).current_due, dueNow);

  // --- delete ---
  deletePayment(db, partyType, id, b.id);
  eq('deleted payment is gone from unbilled and history', [getUnbilledPayments(db, partyType, id).length, getPayments(db, partyType, id).length], [1, 1]);
  eq('due goes back up by the deleted amount', getParty(db, partyType, id).current_due, dueNow + 200);
  throws('deleting it again fails cleanly', () => deletePayment(db, partyType, id, b.id), 'not found');
  throws('editing a deleted payment fails cleanly', () => updatePayment(db, partyType, id, b.id, 10, 'cash'), 'not found');
  eq('...and changes nothing', getParty(db, partyType, id).current_due, dueNow + 200);

  // --- edits feed the next bill correctly ---
  const bill = generateBill(db, partyType, id);
  eq('bill carries the corrected payment', bill.payments.map((p) => p.amount), [99]);
  eq('previous due is still the pre-activity balance', bill.previous_due, 1000);

  // --- billed payments are locked ... until the bill is restored ---
  const dueBilled = getParty(db, partyType, id).current_due;
  throws('billed payment cannot be edited', () => updatePayment(db, partyType, id, a.id, 10, 'cash'), 'already been billed');
  throws('billed payment cannot be deleted', () => deletePayment(db, partyType, id, a.id), 'already been billed');
  eq('due untouched by the refused attempts', getParty(db, partyType, id).current_due, dueBilled);
  restoreBill(db, partyType, bill.id);
  updatePayment(db, partyType, id, a.id, 120, 'cash');
  eq('after Restore bill the payment is editable again (due - 21)', getParty(db, partyType, id).current_due, dueBilled - 21);
  deletePayment(db, partyType, id, a.id);
  eq('...and deletable: due back to opening + entries', getParty(db, partyType, id).current_due, 2000);
  eq('no payments left', getPayments(db, partyType, id).length, 0);
}

console.log('\n--- A payment can only be changed through its own party ---');
{
  const s = createParty(db, 'supplier', 'Iso S', null, 0);
  const c = createParty(db, 'customer', 'Iso C', null, 0);
  const sp = recordPayment(db, 'supplier', s, 500, null, null, 'cash', '2026-08-01');
  const cp = recordPayment(db, 'customer', c, 700, null, null, 'cash', '2026-08-01');
  const s2 = createParty(db, 'supplier', 'Iso S2', null, 0);
  throws('other supplier cannot edit it', () => updatePayment(db, 'supplier', s2, sp.id, 1, 'cash'), 'not found');
  throws('other supplier cannot delete it', () => deletePayment(db, 'supplier', s2, sp.id), 'not found');
  throws('customer side cannot touch a supplier payment id', () => deletePayment(db, 'customer', c, sp.id), 'not found');
  eq('nothing moved', [getParty(db, 'supplier', s).current_due, getParty(db, 'customer', c).current_due, getParty(db, 'supplier', s2).current_due], [-500, -700, 0]);
  void cp;
}

console.log(process.exitCode ? '\nSome checks FAILED.' : '\nAll payment edit/delete checks passed.');
