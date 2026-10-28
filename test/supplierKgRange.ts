// Checks for the supplier profile's "Total KG bought" date-range view.
// The total must be the EXACT sum of the weights - never floored or ceiled.
// Run:  npx ts-node test/supplierKgRange.ts
import { openDatabase } from '../src/main/db/database';
import { createParty, addEntry, generateBill, getWeightInDateRange } from '../src/main/services/partyService';
import { sumWeightsExact } from '../src/shared/weight';

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}${detail ? ': ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}
function throws(label: string, fn: () => unknown, mustContain: string) {
  try {
    fn();
    check(label, false, 'should have thrown');
  } catch (e) {
    check(label, (e as Error).message.includes(mustContain), (e as Error).message);
  }
}

// ---- the exact example from the owner -----------------------------------------
console.log('--- 8.9 + 3.9 + 4.3 must be 17.1 KG (not 17) ---');
const naive = 8.9 + 3.9 + 4.3;
console.log(`(for reference, plain float addition gives ${naive})`);
check('sumWeightsExact([8.9, 3.9, 4.3]) === 17.1', sumWeightsExact([8.9, 3.9, 4.3]) === 17.1, String(sumWeightsExact([8.9, 3.9, 4.3])));
check('displays as "17.1" (what the screen shows)', String(sumWeightsExact([8.9, 3.9, 4.3])) === '17.1');
check('0.1 + 0.2 is exactly 0.3 (plain floats say 0.30000000000000004)', sumWeightsExact([0.1, 0.2]) === 0.3);
check('empty list totals 0', sumWeightsExact([]) === 0);
check('not floored: 0.9 stays 0.9', sumWeightsExact([0.9]) === 0.9);
check('not ceiled: 16.1 stays 16.1', sumWeightsExact([8.0, 8.1]) === 16.1);

// Brute force: random 2-decimal weights vs exact integer arithmetic (in hundredths).
let wrong = 0;
for (let run = 0; run < 20000; run++) {
  const n = 1 + Math.floor(Math.random() * 40);
  const hundredths: number[] = [];
  for (let i = 0; i < n; i++) hundredths.push(1 + Math.floor(Math.random() * 15000)); // 0.01 .. 150.00 kg
  const expected = hundredths.reduce((a, b) => a + b, 0) / 100;
  if (sumWeightsExact(hundredths.map((h) => h / 100)) !== expected) wrong++;
}
check('20,000 random sets of 2-decimal weights all sum exactly', wrong === 0, `${wrong} wrong`);

// ---- through the real database ---------------------------------------------------
console.log('\n--- Date-range query through the real database ---');
const db = openDatabase(':memory:');
const ali = createParty(db, 'supplier', 'Ali', null, 0);
const bilal = createParty(db, 'supplier', 'Bilal', null, 0);

// September purchases for Ali (rates differ so none count as duplicates).
addEntry(db, 'supplier', ali, 'Chicken', 8.9, 300, '2026-09-01'); // first day of range
addEntry(db, 'supplier', ali, 'Chicken', 3.9, 301, '2026-09-15');
addEntry(db, 'supplier', ali, 'Chicken', 4.3, 302, '2026-09-30'); // last day of range
// Outside the range - must NOT be counted.
addEntry(db, 'supplier', ali, 'Chicken', 50, 300, '2026-08-31');
addEntry(db, 'supplier', ali, 'Chicken', 60, 300, '2026-10-01');
// Another supplier, inside the range - must NOT be counted for Ali.
addEntry(db, 'supplier', bilal, 'Chicken', 99, 300, '2026-09-10');

const r = getWeightInDateRange(db, 'supplier', ali, '2026-09-01', '2026-09-30');
check('total KG for 1 Sep - 30 Sep is exactly 17.1', r.total_weight_kg === 17.1, String(r.total_weight_kg));
check('three purchase rows', r.rows.length === 3, String(r.rows.length));
check('rows are in date order with their exact weights', r.rows.map((x) => `${x.entry_date}:${x.weight_kg}`).join(' | ') === '2026-09-01:8.9 | 2026-09-15:3.9 | 2026-09-30:4.3', r.rows.map((x) => `${x.entry_date}:${x.weight_kg}`).join(' | '));
check('both boundary days are included (1 Sep and 30 Sep)', r.rows[0].entry_date === '2026-09-01' && r.rows[2].entry_date === '2026-09-30');
check('other supplier and out-of-range days are excluded', r.total_weight_kg === 17.1);

// Two purchases on the same day stay as two rows (each purchase is visible) and add up.
addEntry(db, 'supplier', ali, 'Chicken', 2.5, 310, '2026-09-15');
const same = getWeightInDateRange(db, 'supplier', ali, '2026-09-15', '2026-09-15');
check('single-day range works and lists both purchases', same.rows.length === 2 && same.total_weight_kg === 6.4, `${same.rows.length} rows, ${same.total_weight_kg} KG`);

// Billing an entry doesn't change how much was bought.
generateBill(db, 'supplier', ali);
const billed = getWeightInDateRange(db, 'supplier', ali, '2026-09-01', '2026-09-30');
check('billed purchases still count', billed.total_weight_kg === 19.6, String(billed.total_weight_kg));

// Empty range.
const empty = getWeightInDateRange(db, 'supplier', ali, '2025-01-01', '2025-01-31');
check('range with no purchases -> no rows, total 0', empty.rows.length === 0 && empty.total_weight_kg === 0);

// Item label doesn't matter - it's total KG bought.
addEntry(db, 'supplier', bilal, 'Live Chicken', 12.25, 280, '2026-09-20');
addEntry(db, 'supplier', bilal, 'Chicken', 7.75, 285, '2026-09-21');
check('different item labels are all included', getWeightInDateRange(db, 'supplier', bilal, '2026-09-01', '2026-09-30').total_weight_kg === 119);

// Time of day on the last day must not push an entry out of the range
// (entry_date is stored as 'YYYY-MM-DD HH:MM:SS').
const stored = db.prepare("SELECT entry_date FROM supplier_entries WHERE supplier_id = ? ORDER BY id LIMIT 1").get(ali) as { entry_date: string };
check('entries are stored with a time of day (so the boundary test is meaningful)', /\d{2}:\d{2}:\d{2}$/.test(stored.entry_date), stored.entry_date);

// ---- validation -------------------------------------------------------------------
console.log('\n--- Validation ---');
throws('from after to is rejected', () => getWeightInDateRange(db, 'supplier', ali, '2026-09-30', '2026-09-01'), 'can\u2019t be after');
throws('bad date format is rejected', () => getWeightInDateRange(db, 'supplier', ali, '30-09-2026', '2026-09-30'), 'YYYY-MM-DD');
throws('unknown supplier is rejected', () => getWeightInDateRange(db, 'supplier', 9999, '2026-09-01', '2026-09-30'), 'not found');

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nAll supplier KG range checks passed.');
