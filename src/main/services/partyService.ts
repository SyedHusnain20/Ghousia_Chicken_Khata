import Database from 'better-sqlite3';
import { PartyType, Party, Entry, Bill, BillListItem, BillDetail, Payment } from '../types';

// Table names differ by party type but the logic is identical, so we
// resolve table names once per call rather than duplicating every function.
function tables(partyType: PartyType) {
  if (partyType === 'supplier') {
    return { party: 'suppliers', entries: 'supplier_entries', bills: 'supplier_bills', fk: 'supplier_id' };
  }
  return { party: 'customers', entries: 'customer_entries', bills: 'customer_bills', fk: 'customer_id' };
}

export function createParty(
  db: Database.Database,
  partyType: PartyType,
  name: string,
  contactNumber: string | null,
  openingDue: number = 0
): number {
  const t = tables(partyType);
  const stmt = db.prepare(
    `INSERT INTO ${t.party} (name, contact_number, opening_due, current_due) VALUES (?, ?, ?, ?)`
  );
  const result = stmt.run(name, contactNumber, openingDue, openingDue);
  return result.lastInsertRowid as number;
}

export function getParty(db: Database.Database, partyType: PartyType, partyId: number): Party {
  const t = tables(partyType);
  const party = db.prepare(`SELECT * FROM ${t.party} WHERE id = ?`).get(partyId) as Party | undefined;
  if (!party) throw new Error(`${partyType} ${partyId} not found`);
  return party;
}

export function getAllParties(db: Database.Database, partyType: PartyType): Party[] {
  const t = tables(partyType);
  return db.prepare(`SELECT * FROM ${t.party} ORDER BY name COLLATE NOCASE`).all() as Party[];
}

/**
 * Deletes a party, but only when it's safe to do so with zero risk to the
 * books: no outstanding balance, and no transaction history whatsoever.
 * Entries/bills/payments are never deleted themselves (even if we tried,
 * that would silently change the totals on a Daily Ledger date that's
 * already in the past, or falsify a bill the party may already have a
 * printed copy of) - so a party with any history at all must stay on
 * record. In practice this means delete is for cleaning up a party that
 * was created by mistake (wrong name, duplicate, etc.) and never actually
 * used for anything yet.
 */
export function deleteParty(db: Database.Database, partyType: PartyType, partyId: number): void {
  const t = tables(partyType);
  const party = getParty(db, partyType, partyId);

  if (party.current_due !== 0) {
    const owed = party.current_due > 0 ? 'has an outstanding balance' : 'is owed a credit balance';
    throw new Error(
      `Can't delete ${party.name} - they ${owed} of Rs. ${Math.abs(party.current_due)}. Settle it to zero first.`
    );
  }

  const entryCount = (
    db.prepare(`SELECT COUNT(*) as c FROM ${t.entries} WHERE ${t.fk} = ?`).get(partyId) as { c: number }
  ).c;
  const billCount = (
    db.prepare(`SELECT COUNT(*) as c FROM ${t.bills} WHERE ${t.fk} = ?`).get(partyId) as { c: number }
  ).c;
  const paymentCount = (
    db.prepare(`SELECT COUNT(*) as c FROM payments WHERE party_type = ? AND party_id = ?`).get(partyType, partyId) as {
      c: number;
    }
  ).c;

  if (entryCount > 0 || billCount > 0 || paymentCount > 0) {
    throw new Error(
      `Can't delete ${party.name} - they have transaction history on record, which needs to stay in place to keep past bills and the Daily Ledger accurate.`
    );
  }

  db.prepare(`DELETE FROM ${t.party} WHERE id = ?`).run(partyId);
}

export const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Pakistan Standard Time is a fixed UTC+5 offset with no daylight saving,
// so it's computed explicitly from UTC fields rather than relying on the
// laptop's own system timezone (which may be misconfigured) or SQLite's
// datetime('now'), which returns UTC.
export function pakistanNow(): { date: string; time: string } {
  const pkt = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const y = pkt.getUTCFullYear();
  const m = String(pkt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(pkt.getUTCDate()).padStart(2, '0');
  const hh = String(pkt.getUTCHours()).padStart(2, '0');
  const mm = String(pkt.getUTCMinutes()).padStart(2, '0');
  const ss = String(pkt.getUTCSeconds()).padStart(2, '0');
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}:${ss}` };
}

/**
 * Log a single purchase/sale entry against a party. The party's running
 * due updates immediately (in the same transaction) - due reflects every
 * recorded purchase/sale right away, whether or not it's ever swept into
 * a bill. The entry itself sits "unbilled" (bill_id NULL) until it is
 * later included in a generated bill, but that's purely a billing/receipt
 * concern now - it no longer gates when the due changes.
 *
 * entryDate is optional and lets the shopkeeper backdate an entry's
 * calendar date (e.g. logging Monday's purchase on Wednesday) so it lands
 * in the correct Daily Ledger date. Expects 'YYYY-MM-DD'; defaults to
 * today. Either way, the time-of-day stamped is always the real current
 * time in Pakistan Standard Time - never a placeholder - so entries sort
 * correctly and the actual time an entry was logged is preserved even for
 * backdated entries.
 */
export function addEntry(
  db: Database.Database,
  partyType: PartyType,
  partyId: number,
  itemName: string,
  weightKg: number,
  ratePerKg: number,
  entryDate?: string
): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error('Weight (KG) must be a number greater than zero');
  }
  if (!Number.isFinite(ratePerKg) || ratePerKg <= 0) {
    throw new Error('Rate per KG must be a number greater than zero');
  }
  if (entryDate !== undefined && !DATE_ONLY_RE.test(entryDate)) {
    throw new Error("entryDate must be in 'YYYY-MM-DD' format");
  }

  const t = tables(partyType);
  const lineTotal = floorMoney(weightKg * ratePerKg);

  const run = db.transaction(() => {
    const now = pakistanNow();
    const stampedEntryDate = `${entryDate ?? now.date} ${now.time}`;
    const stmt = db.prepare(
      `INSERT INTO ${t.entries} (${t.fk}, entry_date, item_name, weight_kg, rate_per_kg, line_total)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(partyId, stampedEntryDate, itemName, weightKg, ratePerKg, lineTotal);
    const entryId = result.lastInsertRowid as number;

    const party = getParty(db, partyType, partyId);
    const newDue = floorMoney(party.current_due + lineTotal);
    db.prepare(`UPDATE ${t.party} SET current_due = ? WHERE id = ?`).run(newDue, partyId);

    return entryId;
  });

  return run();
}

export function getUnbilledEntries(db: Database.Database, partyType: PartyType, partyId: number): Entry[] {
  const t = tables(partyType);
  return db
    .prepare(`SELECT * FROM ${t.entries} WHERE ${t.fk} = ? AND bill_id IS NULL ORDER BY entry_date`)
    .all(partyId) as Entry[];
}

/**
 * Edits an existing entry - but only while it's still unbilled. Once an
 * entry is swept into a bill, that bill is an immutable snapshot (the
 * party may already have a printed copy of it), so editing it afterward
 * would silently change a record that's supposed to be fixed. The
 * party's running due is adjusted by the difference between the old and
 * new line totals, not recalculated from scratch, so this stays correct
 * even if other entries have been added/billed in the meantime.
 */
export function updateEntry(
  db: Database.Database,
  partyType: PartyType,
  partyId: number,
  entryId: number,
  itemName: string,
  weightKg: number,
  ratePerKg: number,
  entryDate?: string
): void {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error('Weight (KG) must be a number greater than zero');
  }
  if (!Number.isFinite(ratePerKg) || ratePerKg <= 0) {
    throw new Error('Rate per KG must be a number greater than zero');
  }
  if (entryDate !== undefined && !DATE_ONLY_RE.test(entryDate)) {
    throw new Error("entryDate must be in 'YYYY-MM-DD' format");
  }

  const t = tables(partyType);
  const newLineTotal = floorMoney(weightKg * ratePerKg);

  db.transaction(() => {
    const existing = db
      .prepare(`SELECT * FROM ${t.entries} WHERE id = ? AND ${t.fk} = ?`)
      .get(entryId, partyId) as Entry | undefined;
    if (!existing) throw new Error('Entry not found');
    if (existing.bill_id !== null) {
      throw new Error('This entry has already been billed and can no longer be edited');
    }

    // Preserve the original time-of-day, only replace the calendar date
    // (same convention addEntry uses for backdating) - editing shouldn't
    // silently rewrite when the entry was actually logged.
    const existingTime = existing.entry_date.split(' ')[1] ?? pakistanNow().time;
    const newEntryDate = entryDate !== undefined ? `${entryDate} ${existingTime}` : existing.entry_date;

    db.prepare(
      `UPDATE ${t.entries} SET entry_date = ?, item_name = ?, weight_kg = ?, rate_per_kg = ?, line_total = ? WHERE id = ?`
    ).run(newEntryDate, itemName, weightKg, ratePerKg, newLineTotal, entryId);

    const party = getParty(db, partyType, partyId);
    const dueAdjustment = floorMoney(newLineTotal - existing.line_total);
    const newDue = floorMoney(party.current_due + dueAdjustment);
    db.prepare(`UPDATE ${t.party} SET current_due = ? WHERE id = ?`).run(newDue, partyId);
  })();
}

/**
 * Bundles every unbilled entry for this party into one printable bill and
 * locks them to it. current_due already reflects these entries (it was
 * updated back in addEntry when each was logged), so this does NOT add
 * the subtotal to the due again - it only produces the bill record and,
 * if paymentNow>0, reduces the due via recordPayment same as always. Runs
 * as a single transaction so nothing can end up half-updated.
 */
export function generateBill(
  db: Database.Database,
  partyType: PartyType,
  partyId: number,
  paymentNow: number = 0
): Bill {
  const t = tables(partyType);

  const run = db.transaction(() => {
    const party = getParty(db, partyType, partyId);
    const pending = getUnbilledEntries(db, partyType, partyId);

    if (pending.length === 0) {
      throw new Error('No unbilled entries to generate a bill from');
    }

    const subtotal = floorMoney(pending.reduce((sum, e) => sum + e.line_total, 0));
    // current_due already includes this subtotal (added per-entry in
    // addEntry), so "before this bill's entries" is current_due minus it.
    const previousDue = floorMoney(party.current_due - subtotal);
    const totalDueAfterBill = party.current_due;

    const now = pakistanNow();
    const billDate = `${now.date} ${now.time}`;
    const insertBill = db.prepare(
      `INSERT INTO ${t.bills} (${t.fk}, bill_date, previous_due, subtotal, total_due_after_bill, remaining_due)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    // remaining_due is finalized after payment below; insert a placeholder first
    const billResult = insertBill.run(partyId, billDate, previousDue, subtotal, totalDueAfterBill, totalDueAfterBill);
    const billId = billResult.lastInsertRowid as number;

    // Lock the swept-up entries to this bill
    const lockEntries = db.prepare(`UPDATE ${t.entries} SET bill_id = ? WHERE id = ?`);
    for (const entry of pending) lockEntries.run(billId, entry.id);

    // No current_due update here - it's already correct.

    // Payment at bill-generation time is optional
    if (paymentNow > 0) {
      recordPayment(db, partyType, partyId, paymentNow, billId, 'Paid at bill generation');
    }

    const finalParty = getParty(db, partyType, partyId);
    db.prepare(`UPDATE ${t.bills} SET remaining_due = ? WHERE id = ?`).run(finalParty.current_due, billId);

    const items = db.prepare(`SELECT * FROM ${t.entries} WHERE bill_id = ?`).all(billId) as Entry[];

    return {
      id: billId,
      bill_date: billDate,
      previous_due: previousDue,
      subtotal,
      total_due_after_bill: totalDueAfterBill,
      remaining_due: finalParty.current_due,
      items,
    } as Bill;
  });

  return run();
}

/**
 * Records a payment - either tied to a bill (paid at generation time) or
 * standalone (the profile's "just enter a number" field). Overpayment is
 * allowed and simply pushes current_due negative (a credit balance).
 */
export function recordPayment(
  db: Database.Database,
  partyType: PartyType,
  partyId: number,
  amount: number,
  billId: number | null = null,
  note: string | null = null
): Payment {
  if (amount <= 0) throw new Error('Payment amount must be positive');
  const t = tables(partyType);

  const run = db.transaction(() => {
    const now = pakistanNow();
    const paidAt = `${now.date} ${now.time}`;
    const insertPayment = db.prepare(
      `INSERT INTO payments (party_type, party_id, bill_id, amount, note, paid_at) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const result = insertPayment.run(partyType, partyId, billId, amount, note, paidAt);

    const party = getParty(db, partyType, partyId);
    const newDue = floorMoney(party.current_due - amount);
    db.prepare(`UPDATE ${t.party} SET current_due = ? WHERE id = ?`).run(newDue, partyId);

    if (billId !== null) {
      db.prepare(`UPDATE ${t.bills} SET remaining_due = ? WHERE id = ?`).run(newDue, billId);
    }

    return db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid) as Payment;
  });

  return run();
}

/**
 * Full payment history for a party, most recent first - backs the
 * "Payment history" list on the Supplier/Customer profile screen. Includes
 * both standalone payments (bill_id NULL) and payments recorded at bill
 * generation time (bill_id set), since both are logged into the same
 * `payments` table (spec section 21).
 */
export function getPayments(db: Database.Database, partyType: PartyType, partyId: number): Payment[] {
  return db
    .prepare(
      `SELECT * FROM payments WHERE party_type = ? AND party_id = ? ORDER BY paid_at DESC, id DESC`
    )
    .all(partyType, partyId) as Payment[];
}

/**
 * Bill history for one party, most recent first - backs the "Bill
 * history" list on the Supplier/Customer profile screen. Deliberately
 * lightweight (no items) since the profile just needs a scannable list;
 * getBillById fetches the full printable bill on demand.
 */
export function getBillsForParty(db: Database.Database, partyType: PartyType, partyId: number): BillListItem[] {
  const t = tables(partyType);
  const party = getParty(db, partyType, partyId);
  const rows = db
    .prepare(`SELECT * FROM ${t.bills} WHERE ${t.fk} = ? ORDER BY bill_date DESC, id DESC`)
    .all(partyId) as Array<Bill & Record<string, unknown>>;
  return rows.map((row) => ({
    id: row.id,
    party_type: partyType,
    party_id: partyId,
    party_name: party.name,
    bill_date: row.bill_date,
    previous_due: row.previous_due,
    subtotal: row.subtotal,
    total_due_after_bill: row.total_due_after_bill,
    remaining_due: row.remaining_due,
  }));
}

/**
 * The full record behind a printable bill - the bill row, its locked-in
 * items (entries whose bill_id matches), and the party's name/contact for
 * the receipt header. Throws if the bill doesn't exist.
 */
export function getBillById(db: Database.Database, partyType: PartyType, billId: number): BillDetail {
  const t = tables(partyType);
  const bill = db.prepare(`SELECT * FROM ${t.bills} WHERE id = ?`).get(billId) as
    | (Bill & Record<string, unknown>)
    | undefined;
  if (!bill) throw new Error(`${partyType} bill ${billId} not found`);

  const items = db
    .prepare(`SELECT * FROM ${t.entries} WHERE bill_id = ? ORDER BY entry_date`)
    .all(billId) as Entry[];

  const partyId = bill[t.fk] as number;
  const party = getParty(db, partyType, partyId);

  return {
    id: bill.id,
    bill_date: bill.bill_date,
    previous_due: bill.previous_due,
    subtotal: bill.subtotal,
    total_due_after_bill: bill.total_due_after_bill,
    remaining_due: bill.remaining_due,
    items,
    party_type: partyType,
    party_id: partyId,
    party_name: party.name,
    party_contact: party.contact_number,
  };
}

// Every money figure in this app - line totals, dues, bill amounts,
// payments, ledger totals - is a whole number of rupees. No paisas
// anywhere: 70.2 KG at Rs. 302/KG is Rs. 21,200 (21,200.4 floored), not
// Rs. 21,200.40. This is the single place that decision is made; every
// money calculation in the app routes through this function (or the
// renderer-side copies in dailyLedger.ts/format.ts, which can't import
// this file directly - see their own comments).
export function floorMoney(n: number): number {
  return Math.floor(n);
}