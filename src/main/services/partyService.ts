import Database from 'better-sqlite3';
import { PartyType, Party, Entry, Bill, Payment } from '../types';

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

export const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Log a single purchase/sale entry against a party. No bill is created and
 * no due is touched here - the entry just sits "unbilled" until it's swept
 * into a generated bill.
 *
 * entryDate is optional and lets the shopkeeper backdate an entry (e.g.
 * logging Monday's purchase on Wednesday) so it lands in the correct
 * Daily Ledger date. Expects 'YYYY-MM-DD'; defaults to right now.
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
  const lineTotal = round2(weightKg * ratePerKg);

  if (entryDate) {
    // Midday timestamp keeps this entry sorting sensibly alongside
    // same-day entries that used the default "now" timestamp, without
    // implying a specific time of day that wasn't actually recorded.
    const stmt = db.prepare(
      `INSERT INTO ${t.entries} (${t.fk}, entry_date, item_name, weight_kg, rate_per_kg, line_total)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(partyId, `${entryDate} 12:00:00`, itemName, weightKg, ratePerKg, lineTotal);
    return result.lastInsertRowid as number;
  }

  const stmt = db.prepare(
    `INSERT INTO ${t.entries} (${t.fk}, item_name, weight_kg, rate_per_kg, line_total) VALUES (?, ?, ?, ?, ?)`
  );
  const result = stmt.run(partyId, itemName, weightKg, ratePerKg, lineTotal);
  return result.lastInsertRowid as number;
}

export function getUnbilledEntries(db: Database.Database, partyType: PartyType, partyId: number): Entry[] {
  const t = tables(partyType);
  return db
    .prepare(`SELECT * FROM ${t.entries} WHERE ${t.fk} = ? AND bill_id IS NULL ORDER BY entry_date`)
    .all(partyId) as Entry[];
}

/**
 * Bundles every unbilled entry for this party into one new bill, adds the
 * party's existing due, optionally records a payment against it, and
 * updates the party's running due. Runs as a single transaction so the
 * due figure can never end up half-updated.
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

    const subtotal = round2(pending.reduce((sum, e) => sum + e.line_total, 0));
    const previousDue = party.current_due;
    const totalDueAfterBill = round2(previousDue + subtotal);

    const insertBill = db.prepare(
      `INSERT INTO ${t.bills} (${t.fk}, previous_due, subtotal, total_due_after_bill, remaining_due)
       VALUES (?, ?, ?, ?, ?)`
    );
    // remaining_due is finalized after payment below; insert a placeholder first
    const billResult = insertBill.run(partyId, previousDue, subtotal, totalDueAfterBill, totalDueAfterBill);
    const billId = billResult.lastInsertRowid as number;

    // Lock the swept-up entries to this bill
    const lockEntries = db.prepare(`UPDATE ${t.entries} SET bill_id = ? WHERE id = ?`);
    for (const entry of pending) lockEntries.run(billId, entry.id);

    // Set the party's due to the bill total before any payment is applied
    db.prepare(`UPDATE ${t.party} SET current_due = ? WHERE id = ?`).run(totalDueAfterBill, partyId);

    // Payment at bill-generation time is optional
    if (paymentNow > 0) {
      recordPayment(db, partyType, partyId, paymentNow, billId, 'Paid at bill generation');
    }

    const finalParty = getParty(db, partyType, partyId);
    db.prepare(`UPDATE ${t.bills} SET remaining_due = ? WHERE id = ?`).run(finalParty.current_due, billId);

    const items = db.prepare(`SELECT * FROM ${t.entries} WHERE bill_id = ?`).all(billId) as Entry[];

    return {
      id: billId,
      bill_date: new Date().toISOString(),
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
    const insertPayment = db.prepare(
      `INSERT INTO payments (party_type, party_id, bill_id, amount, note) VALUES (?, ?, ?, ?, ?)`
    );
    const result = insertPayment.run(partyType, partyId, billId, amount, note);

    const party = getParty(db, partyType, partyId);
    const newDue = round2(party.current_due - amount);
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

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}