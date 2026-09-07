// One-time admin tool - NOT part of the shipped app, never installed on a
// client's PC. Run this yourself, directly against a copy of the live
// khata.db file, to find purchase/sale entries that were accidentally
// logged twice (same party, item, weight, rate, and calendar date) - e.g.
// the same delivery slip typed into "Purchases" two times.
//
// A "duplicate" here means: same party, same item name, same weight (kg),
// same rate/kg, and the same calendar date - regardless of what time of
// day each copy was logged, and regardless of whether either copy has
// since been swept into a bill.
//
// Usage (dry run - reports everything, changes nothing):
//   node admin-tools/find-duplicate-entries.js "path/to/khata.db"
//
// Once you've checked the report, you can safely auto-remove the extra
// copies that are still UNBILLED (this keeps the earliest copy, deletes
// the rest, and reduces the party's current_due to match):
//   node admin-tools/find-duplicate-entries.js "path/to/khata.db" --confirm
//
// Duplicates that have ALREADY been swept into a bill are never touched by
// --confirm alone - that bill may already be a printed/shared document, so
// silently changing its totals is a real business decision, not just a
// data-cleanup one. The report below tells you exactly which bills are
// affected and by how much. If you (the shopkeeper/dev) decide a specific
// already-billed duplicate really should be corrected in the database too
// (not just handled as a credit/adjustment with the party), re-run with
// --include-billed - this also fixes up that one bill's own subtotal /
// total_due_after_bill / remaining_due so it stays internally consistent,
// but it does NOT touch any LATER bill for that party (their stored
// "previous due" was carried forward from the running balance at the time
// and is left as historical record - review those manually if needed).
//
// ALWAYS back up khata.db before running this with --confirm. If OneDrive
// sync is on, this is a good moment to also grab a manual copy first.

const path = require('path');
const Database = require('better-sqlite3');

const [, , dbPath, ...rest] = process.argv;
const confirmed = rest.includes('--confirm');
const includeBilled = rest.includes('--include-billed');

if (!dbPath) {
  console.error('Usage: node find-duplicate-entries.js <path-to-khata.db> [--confirm] [--include-billed]');
  process.exit(1);
}

const TABLES = {
  supplier: { party: 'suppliers', entries: 'supplier_entries', bills: 'supplier_bills', fk: 'supplier_id' },
  customer: { party: 'customers', entries: 'customer_entries', bills: 'customer_bills', fk: 'customer_id' },
  shopkeeper: { party: 'shopkeepers', entries: 'shopkeeper_entries', bills: 'shopkeeper_bills', fk: 'shopkeeper_id' },
};

const db = new Database(path.resolve(dbPath));
db.pragma('foreign_keys = ON');

const money = (n) => `Rs. ${Math.floor(n).toLocaleString('en-PK')}`;

let totalGroupsFound = 0;
let totalUnbilledRemoved = 0;
let totalUnbilledAmountFixed = 0;
let totalBilledAmountFlagged = 0;

for (const [partyType, t] of Object.entries(TABLES)) {
  // Group by everything that defines "the same purchase/sale logged twice".
  // date(entry_date) collapses the timestamp down to the calendar day, so
  // it doesn't matter whether the two copies were typed a minute apart or
  // hours apart.
  const groups = db
    .prepare(
      `SELECT ${t.fk} AS party_id, item_name, weight_kg, rate_per_kg, date(entry_date) AS entry_day,
              COUNT(*) AS copies
       FROM ${t.entries}
       GROUP BY ${t.fk}, item_name, weight_kg, rate_per_kg, date(entry_date)
       HAVING COUNT(*) > 1`
    )
    .all();

  if (groups.length === 0) continue;

  console.log(`\n=== ${partyType.toUpperCase()} entries ===`);

  for (const g of groups) {
    totalGroupsFound += 1;
    const party = db.prepare(`SELECT * FROM ${t.party} WHERE id = ?`).get(g.party_id);
    const copies = db
      .prepare(
        `SELECT * FROM ${t.entries}
         WHERE ${t.fk} = ? AND item_name = ? AND weight_kg = ? AND rate_per_kg = ? AND date(entry_date) = ?
         ORDER BY id ASC`
      )
      .all(g.party_id, g.item_name, g.weight_kg, g.rate_per_kg, g.entry_day);

    console.log(
      `\n${party ? party.name : `(party #${g.party_id})`} - ${g.copies}x "${g.item_name}" ${g.weight_kg}kg @ Rs.${g.rate_per_kg}/kg on ${g.entry_day} (${money(g.weight_kg * g.rate_per_kg)} each)`
    );
    for (const c of copies) {
      const billNote = c.bill_id ? `billed on bill #${c.bill_id}` : 'still unbilled';
      console.log(`  - entry #${c.id}, logged ${c.entry_date} (${billNote})`);
    }

    // Keep the first-logged copy; every other copy in this group is the
    // accidental repeat.
    const [, ...extras] = copies;
    const unbilledExtras = extras.filter((e) => e.bill_id === null);
    const billedExtras = extras.filter((e) => e.bill_id !== null);

    if (unbilledExtras.length > 0) {
      const amount = unbilledExtras.reduce((sum, e) => sum + e.line_total, 0);
      console.log(
        `  -> ${unbilledExtras.length} unbilled cop${unbilledExtras.length === 1 ? 'y' : 'ies'} (entr${unbilledExtras.length === 1 ? 'y' : 'ies'} #${unbilledExtras.map((e) => e.id).join(', #')}), worth ${money(amount)} total`
      );
      if (confirmed) {
        const run = db.transaction(() => {
          for (const e of unbilledExtras) {
            db.prepare(`DELETE FROM ${t.entries} WHERE id = ?`).run(e.id);
          }
          const current = db.prepare(`SELECT current_due FROM ${t.party} WHERE id = ?`).get(g.party_id);
          db.prepare(`UPDATE ${t.party} SET current_due = ? WHERE id = ?`).run(
            Math.floor(current.current_due - amount),
            g.party_id
          );
        });
        run();
        console.log(`     Removed. ${party.name}'s current due reduced by ${money(amount)}.`);
        totalUnbilledRemoved += unbilledExtras.length;
        totalUnbilledAmountFixed += amount;
      }
    }

    if (billedExtras.length > 0) {
      const amount = billedExtras.reduce((sum, e) => sum + e.line_total, 0);
      totalBilledAmountFlagged += amount;
      const billIds = [...new Set(billedExtras.map((e) => e.bill_id))];
      console.log(
        `  -> ${billedExtras.length} cop${billedExtras.length === 1 ? 'y' : 'ies'} already billed on bill #${billIds.join(', #')} - worth ${money(amount)}. NOT auto-removed (would change an already-generated bill).`
      );
      if (!includeBilled) {
        console.log(`     Re-run with --include-billed to also correct ${billIds.length === 1 ? "that bill's" : "those bills'"} own totals.`);
      } else if (confirmed) {
        for (const e of billedExtras) {
          fixBilledDuplicate(t, partyType, party, e);
        }
      } else {
        console.log('     (Add --confirm too, to actually apply the fix.)');
      }
    }
  }
}

if (totalGroupsFound === 0) {
  console.log('No duplicate entries found - nothing to do.');
  db.close();
  process.exit(0);
}

console.log('\n--------------------------------------------------');
if (!confirmed) {
  console.log(`DRY RUN - found ${totalGroupsFound} duplicate group(s). Nothing has been changed.`);
  console.log('Re-run with --confirm to remove the still-unbilled duplicates automatically.');
  if (totalBilledAmountFlagged > 0) {
    console.log(`${money(totalBilledAmountFlagged)} worth of duplicates are already on generated bills - see --include-billed above.`);
  }
} else {
  console.log(`Removed ${totalUnbilledRemoved} unbilled duplicate entr${totalUnbilledRemoved === 1 ? 'y' : 'ies'} worth ${money(totalUnbilledAmountFixed)} total.`);
  if (totalBilledAmountFlagged > 0 && !includeBilled) {
    console.log(`${money(totalBilledAmountFlagged)} worth of already-billed duplicates were left untouched - re-run with --include-billed if you want those corrected too.`);
  }
}

db.close();

/**
 * Removes one already-billed duplicate entry and recomputes ITS OWN bill's
 * subtotal/total_due_after_bill/remaining_due from what's left on that
 * bill, so the bill stays internally consistent if it's ever reprinted.
 * Does not touch any other bill - a later bill's stored "previous due" for
 * this party was carried forward from the running balance at the time and
 * is left as-is; review that manually if it also needs correcting.
 */
function fixBilledDuplicate(t, partyType, party, duplicateEntry) {
  const bill = db.prepare(`SELECT * FROM ${t.bills} WHERE id = ?`).get(duplicateEntry.bill_id);
  if (!bill) {
    console.log(`     Could not find bill #${duplicateEntry.bill_id} - skipping entry #${duplicateEntry.id}.`);
    return;
  }

  const run = db.transaction(() => {
    db.prepare(`DELETE FROM ${t.entries} WHERE id = ?`).run(duplicateEntry.id);

    const remainingItems = db.prepare(`SELECT * FROM ${t.entries} WHERE bill_id = ?`).all(bill.id);
    const payments = db.prepare(`SELECT * FROM payments WHERE bill_id = ?`).all(bill.id);
    const newSubtotal = Math.floor(remainingItems.reduce((sum, e) => sum + e.line_total, 0));
    const newTotalDueAfterBill = Math.floor(bill.previous_due + newSubtotal);
    const paymentsTotal = Math.floor(payments.reduce((sum, p) => sum + p.amount, 0));
    const newRemainingDue = Math.floor(newTotalDueAfterBill - paymentsTotal);

    db.prepare(
      `UPDATE ${t.bills} SET subtotal = ?, total_due_after_bill = ?, remaining_due = ? WHERE id = ?`
    ).run(newSubtotal, newTotalDueAfterBill, newRemainingDue, bill.id);

    const current = db.prepare(`SELECT current_due FROM ${t.party} WHERE id = ?`).get(party.id);
    db.prepare(`UPDATE ${t.party} SET current_due = ? WHERE id = ?`).run(
      Math.floor(current.current_due - duplicateEntry.line_total),
      party.id
    );
  });
  run();

  console.log(
    `     Fixed: removed entry #${duplicateEntry.id} from bill #${bill.id}, new bill subtotal ${money(bill.subtotal - duplicateEntry.line_total)}. ${party.name}'s current due reduced by ${money(duplicateEntry.line_total)}.`
  );
  console.log(
    `     NOTE: any bill for ${party.name} generated AFTER #${bill.id} still shows its old "previous due" figure - check ${partyType === 'customer' ? 'their' : 'that'} later bills by hand if this needs to be reflected there too.`
  );
}
