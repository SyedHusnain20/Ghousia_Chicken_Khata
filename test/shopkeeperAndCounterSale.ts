// Standalone checks for (1) shopkeeper sale + purchase, and (2) Counter Sale:
//   npx ts-node test/shopkeeperAndCounterSale.ts
import { openDatabase } from '../src/main/db/database';
import {
  createParty,
  getParty,
  addEntry,
  updateEntry,
  deleteEntry,
  recordPayment,
  updatePayment,
  deletePayment,
  generateBill,
  restoreBill,
  getBillById,
  getShopkeeperTotals,
} from '../src/main/services/partyService';
import {
  createDailyLedger,
  getDailyLedger,
  listDailyLedgers,
} from '../src/main/services/dailyLedgerService';
import { listAllBills } from '../src/main/services/billService';
import {
  addCounterSaleEntry,
  deleteCounterSaleEntry,
  listPendingCounterSaleEntries,
  generateCounterSaleBill,
  listCounterSaleBillsForDate,
  getCounterSaleBill,
  markCounterSaleBillPaid,
  restoreCounterSaleBill,
} from '../src/main/services/counterSaleService';
import { buildBillHtml, buildCounterSaleBillHtml } from '../src/main/reports/billImageShare';
import { summarizeShopkeeperBill, shopkeeperBalance } from '../src/shared/shopkeeperBill';

function eq(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!pass) process.exitCode = 1;
}
function rejects(label: string, fn: () => void) {
  try { fn(); console.log(`FAIL - ${label} should have thrown`); process.exitCode = 1; }
  catch (e) { console.log(`PASS - ${label} rejected: ${(e as Error).message}`); }
}

const db = openDatabase(':memory:');
const D = '2026-11-08';

console.log('\n--- Shopkeeper: purchases and sales move the balance in opposite directions ---');
const k = createParty(db, 'shopkeeper', 'Raza Shop', '03001234567', 0);
addEntry(db, 'shopkeeper', k, 'Chicken', 10, 300, D);                       // purchase 3000 -> we owe 3000
eq('after a 3000 purchase the shop owes 3000', getParty(db, 'shopkeeper', k).current_due, 3000);
const saleId = addEntry(db, 'shopkeeper', k, 'Boneless', 5, 800, D, false, 'sale'); // sale 4000
eq('after a 4000 sale: 3000 - 4000 = -1000 (they owe the shop)', getParty(db, 'shopkeeper', k).current_due, -1000);
eq('balance reads as receivable 1000', shopkeeperBalance(-1000), { kind: 'receivable', amount: 1000 });
eq('lifetime totals', getShopkeeperTotals(db, k), { total_sale: 4000, total_purchase: 3000 });

console.log('\n--- Same item/weight/rate as sale vs purchase is NOT a duplicate; a repeat sale is ---');
addEntry(db, 'shopkeeper', k, 'Chicken', 10, 300, D, false, 'sale');       // same figures as the purchase, but a sale
eq('different type accepted, due now -1000 - 3000', getParty(db, 'shopkeeper', k).current_due, -4000);
rejects('repeating that exact sale needs confirmation', () => addEntry(db, 'shopkeeper', k, 'Chicken', 10, 300, D, false, 'sale'));
deleteEntry(db, 'shopkeeper', k, (db.prepare("SELECT id FROM shopkeeper_entries WHERE item_name='Chicken' AND entry_type='sale'").get() as any).id);
eq('deleting that sale restores the due', getParty(db, 'shopkeeper', k).current_due, -1000);

console.log('\n--- Edit a sale: due follows the difference ---');
updateEntry(db, 'shopkeeper', k, saleId, 'Boneless', 5, 900);               // 4500
eq('sale edited 4000 -> 4500, due -1500', getParty(db, 'shopkeeper', k).current_due, -1500);

console.log('\n--- Payments in both directions ---');
const inPay = recordPayment(db, 'shopkeeper', k, 500, null, null, 'cash', D, 'in');   // they paid us 500
eq('they paid 500 of the 1500 they owe -> -1000', getParty(db, 'shopkeeper', k).current_due, -1000);
updatePayment(db, 'shopkeeper', k, inPay.id, 700, 'cash', D);
eq('payment edited to 700 -> -800', getParty(db, 'shopkeeper', k).current_due, -800);
rejects('customers cannot take an inbound payment', () => {
  const c = createParty(db, 'customer', 'C', null, 0);
  recordPayment(db, 'customer', c, 10, null, null, 'cash', D, 'in');
});

console.log('\n--- Bill: sales, purchases, previous due, payments, remaining ---');
const bill = generateBill(db, 'shopkeeper', k);
eq('previous due is the pre-activity balance (0)', bill.previous_due, 0);
eq('bill subtotal = purchases - sales = 3000 - 4500', bill.subtotal, -1500);
eq('remaining = -1500 + 700 inbound payment', bill.remaining_due, -800);
eq('remaining matches the live balance', bill.remaining_due, getParty(db, 'shopkeeper', k).current_due);
const detail = getBillById(db, 'shopkeeper', bill.id);
const sum = summarizeShopkeeperBill(detail);
eq('bill splits 1 sale / 1 purchase', [sum.sales.length, sum.purchases.length], [1, 1]);
eq('total sale / total purchase', [sum.totalSale, sum.totalPurchase], [4500, 3000]);
eq('payment direction is kept on the bill', detail.payments.map((p) => p.direction), ['in']);

console.log('\n--- Previous due carries into the next bill; restore keeps the due ---');
addEntry(db, 'shopkeeper', k, 'Lever', 2, 500, D);                          // purchase 1000 -> -800 + 1000 = 200
const bill2 = generateBill(db, 'shopkeeper', k);
eq('second bill previous due = -800 (they owed us 800)', bill2.previous_due, -800);
eq('second bill remaining = -800 + 1000', bill2.remaining_due, 200);
const r = restoreBill(db, 'shopkeeper', bill2.id);
eq('restore puts the entry back', r.entriesRestored, 1);
eq('due unchanged by restore', getParty(db, 'shopkeeper', k).current_due, 200);

console.log('\n--- Existing party types are unchanged ---');
const sup = createParty(db, 'supplier', 'Ali', null, 0);
addEntry(db, 'supplier', sup, 'Chicken', 10, 100, D);
recordPayment(db, 'supplier', sup, 300, null, null, 'cash', D);
eq('supplier: +1000 purchase, -300 payment', getParty(db, 'supplier', sup).current_due, 700);
rejects('a supplier cannot have sales', () => addEntry(db, 'supplier', sup, 'Chicken', 1, 1, D, false, 'sale'));
const cust = createParty(db, 'customer', 'Cu', null, 0);
addEntry(db, 'customer', cust, 'Chicken', 10, 100, D);
eq('customer sale still adds to what they owe', getParty(db, 'customer', cust).current_due, 1000);

console.log('\n--- Daily ledger: shopkeeper purchase = expense, shopkeeper sale = income ---');
createDailyLedger(db, D);
const led = getDailyLedger(db, D);
// expenses: supplier 1000 + shopkeeper purchases (3000 + 1000 lever) = 5000
eq('expenses = supplier 1000 + shopkeeper purchases 4000', led.supplier_purchases_total, 5000);
// income: customer 1000 + shopkeeper sale 4500
eq('income picks up the shopkeeper sale', led.khata_sales_total, 5500);
eq('history summary agrees with the detail view', listDailyLedgers(db).map((l) => [l.total_income, l.total_expenses]), [[5500, 5000]]);

console.log('\n--- Counter sale ---');
const before = JSON.stringify([getDailyLedger(db, D), listAllBills(db)]);
addCounterSaleEntry(db, { customerName: 'Bilal', customerNumber: '0300', itemName: 'Chicken', weightKg: 2, ratePerKg: 400, entryDate: D });
addCounterSaleEntry(db, { itemName: 'Drum stick', weightKg: 1.5, ratePerKg: 500, entryDate: D });
eq('two pending entries', listPendingCounterSaleEntries(db).length, 2);
const gone = addCounterSaleEntry(db, { itemName: 'Chest', weightKg: 1, ratePerKg: 100, entryDate: D });
deleteCounterSaleEntry(db, gone);
eq('a mistaken pending entry can be deleted', listPendingCounterSaleEntries(db).length, 2);
rejects('zero weight refused', () => addCounterSaleEntry(db, { itemName: 'Chicken', weightKg: 0, ratePerKg: 1 }));
const cs1 = generateCounterSaleBill(db);
eq('one bill holds both items, total 800 + 750', cs1.total, 1550);
eq('customer name/number taken from the entry that had them', [cs1.customer_name, cs1.customer_number], ['Bilal', '0300']);
eq('no pending entries left', listPendingCounterSaleEntries(db).length, 0);
rejects('cannot bill an empty cart', () => generateCounterSaleBill(db));
addCounterSaleEntry(db, { itemName: 'Live', weightKg: 3, ratePerKg: 300, entryDate: D });
generateCounterSaleBill(db);
addCounterSaleEntry(db, { itemName: 'Boneless', weightKg: 1, ratePerKg: 900, entryDate: D });
generateCounterSaleBill(db);
addCounterSaleEntry(db, { itemName: 'Lever', weightKg: 1, ratePerKg: 100, entryDate: '2026-11-09' });
generateCounterSaleBill(db);
const day = listCounterSaleBillsForDate(db, D);
eq('only the selected date shows', day.length, 3);
eq('unnamed customers numbered per day, named one skipped', day.map((b) => b.customer_label), ['Bilal', 'Customer 1', 'Customer 2']);
eq('opening an unnamed bill gives the same label', getCounterSaleBill(db, day[2].id).customer_label, 'Customer 2');
eq('other day has its own numbering', listCounterSaleBillsForDate(db, '2026-11-09').map((b) => b.customer_label), ['Customer 1']);
eq('counter sales never touch the ledger or the Bills list',
  JSON.stringify([getDailyLedger(db, D), listAllBills(db)]) === before, true);
eq('...nor monthly/history totals', listDailyLedgers(db).map((l) => [l.total_income, l.total_expenses]), [[5500, 5000]]);

console.log('\n--- Counter sale: partial payment, mark paid, restore ---');
addCounterSaleEntry(db, { customerName: 'Hina', itemName: 'Chicken', weightKg: 5, ratePerKg: 400, entryDate: D }); // 2000
rejects('cannot pay more than the total', () => generateCounterSaleBill(db, undefined, 2500));
eq('failed attempt left the item pending', listPendingCounterSaleEntries(db).length, 1);
rejects('cannot pay a negative amount', () => generateCounterSaleBill(db, undefined, -5));
const part = generateCounterSaleBill(db, undefined, 500);
eq('partial payment: paid 500, remaining 1500', [part.paid_amount, part.remaining_due], [500, 1500]);
eq('a default bill is fully paid', listCounterSaleBillsForDate(db, D)[0].remaining_due, 0);
const html = buildCounterSaleBillHtml(part);
eq('image shows paid + remaining for an unpaid bill', html.includes('Remaining') && html.includes('Rs. 1,500'), true);
eq('image has no Remaining row on a fully paid bill', buildCounterSaleBillHtml(getCounterSaleBill(db, cs1.id)).includes('Remaining'), false);
const settled = markCounterSaleBillPaid(db, part.id);
eq('marking paid clears the balance', [settled.paid_amount, settled.remaining_due], [2000, 0]);
const restored = restoreCounterSaleBill(db, settled.id);
eq('restore returns the items to pending', [restored.entriesRestored, listPendingCounterSaleEntries(db).length], [1, 1]);
rejects('restored bill no longer exists', () => getCounterSaleBill(db, settled.id));
eq('restore removed it from the day list', listCounterSaleBillsForDate(db, D).some((b) => b.id === settled.id), false);
eq('counter sales still never touch the ledger/Bills list', JSON.stringify([getDailyLedger(db, D), listAllBills(db)]) === before, true);

console.log('\n--- Shopkeeper bill names who paid ---');
const skHtml = buildBillHtml(detail);
eq("their payment reads '<shopkeeper> paid'", skHtml.includes('Raza Shop paid'), true);
const k2 = createParty(db, 'shopkeeper', 'Imran', null, 0);
addEntry(db, 'shopkeeper', k2, 'Chicken', 1, 100, D);
recordPayment(db, 'shopkeeper', k2, 40, null, null, 'cash', D, 'out');
eq("our payment reads '<owner> paid'", buildBillHtml(getBillById(db, 'shopkeeper', generateBill(db, 'shopkeeper', k2).id)).includes('Zafar paid'), true);

console.log('\n--- Migration: an old database gains the new columns, keeping its data ---');
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const Database = require('better-sqlite3');
  const file = path.join(os.tmpdir(), `khata-old-${Date.now()}.db`);
  // Shape of a pre-change database: no entry_type, no direction, and the
  // payments table still carries the old CHECK constraint (forces the rebuild).
  const raw = new Database(file);
  raw.exec(`
    CREATE TABLE shopkeepers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, contact_number TEXT, opening_due REAL NOT NULL DEFAULT 0, current_due REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE shopkeeper_bills (id INTEGER PRIMARY KEY AUTOINCREMENT, shopkeeper_id INTEGER NOT NULL, bill_date TEXT NOT NULL DEFAULT (datetime('now')), previous_due REAL NOT NULL, subtotal REAL NOT NULL, total_due_after_bill REAL NOT NULL, remaining_due REAL NOT NULL);
    CREATE TABLE shopkeeper_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, shopkeeper_id INTEGER NOT NULL, entry_date TEXT NOT NULL, item_name TEXT NOT NULL DEFAULT 'Chicken', weight_kg REAL NOT NULL, rate_per_kg REAL NOT NULL, line_total REAL NOT NULL, bill_id INTEGER);
    CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, party_type TEXT NOT NULL CHECK (party_type IN ('supplier','customer')), party_id INTEGER NOT NULL, bill_id INTEGER, amount REAL NOT NULL, payment_method TEXT, paid_at TEXT NOT NULL DEFAULT (datetime('now')), note TEXT);
    CREATE TABLE counter_sale_bills (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_date TEXT NOT NULL, customer_name TEXT, customer_number TEXT, total REAL NOT NULL);
    INSERT INTO counter_sale_bills (bill_date, total) VALUES ('2026-01-01 10:00:00', 700);
    INSERT INTO shopkeepers (name, current_due) VALUES ('Old Shop', 150);
    INSERT INTO shopkeeper_entries (shopkeeper_id, entry_date, weight_kg, rate_per_kg, line_total) VALUES (1,'2026-01-01 10:00:00',2,100,200);
    INSERT INTO payments (party_type, party_id, amount) VALUES ('supplier',1,50);
  `);
  raw.close();

  const migrated = openDatabase(file);
  const oldEntry = migrated.prepare('SELECT * FROM shopkeeper_entries').get() as any;
  eq('old shopkeeper entry becomes a purchase', oldEntry.entry_type, 'purchase');
  const oldPay = migrated.prepare('SELECT * FROM payments').get() as any;
  eq('old payment becomes an outbound payment', oldPay.direction, 'out');
  eq('older counter-sale bills become fully paid', (migrated.prepare('SELECT paid_amount FROM counter_sale_bills').get() as any).paid_amount, 700);
  eq('old balance untouched', getParty(migrated, 'shopkeeper', 1).current_due, 150);
  addEntry(migrated, 'shopkeeper', 1, 'Live', 1, 100, '2026-01-02', false, 'sale');
  eq('new sale works on the migrated database', getParty(migrated, 'shopkeeper', 1).current_due, 50);
  // Opening it a second time must be a harmless no-op.
  openDatabase(file);
  console.log('PASS - re-opening a migrated database is a no-op');
  fs.unlinkSync(file);
}
