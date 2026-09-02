// One-time admin tool - NOT part of the shipped app, never installed on a
// client's PC. Run this yourself, directly against a copy of the live
// khata.db file, when a party (supplier/customer/shopkeeper) was entered
// entirely by mistake and needs to be fully removed along with whatever
// wrong data was logged against them.
//
// This deliberately bypasses the app's own safe "Delete" button, which
// only allows deleting a party with ZERO history (to protect the Daily
// Ledger's accuracy for real transactions). Use this only when the whole
// party was a mistake - not to erase real, correct business history.
//
// Usage (dry run first - shows what WOULD be deleted, deletes nothing):
//   node admin-tools/force-delete-party.js "path/to/khata.db" supplier "Wrong Name"
//
// Once you've checked the dry run looks right, add --confirm to actually delete:
//   node admin-tools/force-delete-party.js "path/to/khata.db" supplier "Wrong Name" --confirm
//
// ALWAYS back up khata.db before running this with --confirm. If OneDrive
// sync is on, this is a good moment to also grab a manual copy first.

const path = require('path');
const Database = require('better-sqlite3');

const [, , dbPath, partyType, partyName, ...rest] = process.argv;
const confirmed = rest.includes('--confirm');

if (!dbPath || !partyType || !partyName) {
  console.error('Usage: node force-delete-party.js <path-to-khata.db> <supplier|customer|shopkeeper> "<exact name>" [--confirm]');
  process.exit(1);
}

const TABLES = {
  supplier: { party: 'suppliers', entries: 'supplier_entries', bills: 'supplier_bills', fk: 'supplier_id' },
  customer: { party: 'customers', entries: 'customer_entries', bills: 'customer_bills', fk: 'customer_id' },
  shopkeeper: { party: 'shopkeepers', entries: 'shopkeeper_entries', bills: 'shopkeeper_bills', fk: 'shopkeeper_id' },
};

const t = TABLES[partyType];
if (!t) {
  console.error(`Unknown party type '${partyType}' - must be supplier, customer, or shopkeeper.`);
  process.exit(1);
}

const db = new Database(path.resolve(dbPath));
db.pragma('foreign_keys = ON');

const party = db.prepare(`SELECT * FROM ${t.party} WHERE name = ?`).get(partyName);
if (!party) {
  console.error(`No ${partyType} named "${partyName}" found in ${dbPath}.`);
  const all = db.prepare(`SELECT name FROM ${t.party} ORDER BY name`).all().map((r) => r.name);
  console.error(`Existing ${partyType}s: ${all.join(', ') || '(none)'}`);
  process.exit(1);
}

const entryCount = db.prepare(`SELECT COUNT(*) AS c FROM ${t.entries} WHERE ${t.fk} = ?`).get(party.id).c;
const billCount = db.prepare(`SELECT COUNT(*) AS c FROM ${t.bills} WHERE ${t.fk} = ?`).get(party.id).c;
const paymentCount = db
  .prepare(`SELECT COUNT(*) AS c FROM payments WHERE party_type = ? AND party_id = ?`)
  .get(partyType, party.id).c;

console.log('');
console.log(`Found ${partyType}: "${party.name}" (id ${party.id}), current due: Rs. ${party.current_due}`);
console.log(`  - ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} (purchases/sales, billed and unbilled)`);
console.log(`  - ${billCount} bill${billCount === 1 ? '' : 's'}`);
console.log(`  - ${paymentCount} payment${paymentCount === 1 ? '' : 's'}`);
console.log('');

if (!confirmed) {
  console.log('DRY RUN - nothing has been deleted. Re-run with --confirm to actually delete all of the above.');
  db.close();
  process.exit(0);
}

console.log('Deleting...');
const run = db.transaction(() => {
  db.prepare(`DELETE FROM payments WHERE party_type = ? AND party_id = ?`).run(partyType, party.id);
  db.prepare(`DELETE FROM ${t.entries} WHERE ${t.fk} = ?`).run(party.id);
  db.prepare(`DELETE FROM ${t.bills} WHERE ${t.fk} = ?`).run(party.id);
  db.prepare(`DELETE FROM ${t.party} WHERE id = ?`).run(party.id);
});
run();

console.log(`Done. "${party.name}" and all associated history have been permanently removed.`);
console.log('Note: this only affects this one database file - if OneDrive sync is on, it will sync this change up shortly.');
db.close();
