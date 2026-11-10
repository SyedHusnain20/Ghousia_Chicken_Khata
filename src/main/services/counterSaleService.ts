import Database from 'better-sqlite3';
import type { CounterSaleBill, CounterSaleEntry } from '../types';
import { DATE_ONLY_RE, floorMoney, pakistanNow } from './partyService';

// Counter Sale = walk-in sales. No party profile, no running due, no
// payments - just entries that get swept into a bill. Everything lives in
// counter_sale_entries / counter_sale_bills and NOTHING else in the app
// reads those tables: not the Daily Ledger, not profit/loss, not the global
// Bills list, not any party balance. Keep it that way - if a future report
// needs counter sales, add it deliberately rather than by accident.

function cleanOptional(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export interface AddCounterSaleEntryInput {
  customerName?: string | null;
  customerNumber?: string | null;
  itemName: string;
  weightKg: number;
  ratePerKg: number;
  entryDate?: string; // 'YYYY-MM-DD' - omit for today
}

export function addCounterSaleEntry(db: Database.Database, input: AddCounterSaleEntryInput): number {
  if (!input.itemName || input.itemName.trim() === '') throw new Error('Please choose an item');
  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    throw new Error('Weight (KG) must be a number greater than zero');
  }
  if (!Number.isFinite(input.ratePerKg) || input.ratePerKg <= 0) {
    throw new Error('Rate per KG must be a number greater than zero');
  }
  if (input.entryDate !== undefined && !DATE_ONLY_RE.test(input.entryDate)) {
    throw new Error("entryDate must be in 'YYYY-MM-DD' format");
  }

  const now = pakistanNow();
  const stamped = `${input.entryDate ?? now.date} ${now.time}`;
  const lineTotal = floorMoney(input.weightKg * input.ratePerKg);
  const result = db
    .prepare(
      `INSERT INTO counter_sale_entries
         (entry_date, customer_name, customer_number, item_name, weight_kg, rate_per_kg, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      stamped,
      cleanOptional(input.customerName),
      cleanOptional(input.customerNumber),
      input.itemName.trim(),
      input.weightKg,
      input.ratePerKg,
      lineTotal
    );
  return result.lastInsertRowid as number;
}

/** Entries not on any bill yet - the "cart" for the bill about to be generated. */
export function listPendingCounterSaleEntries(db: Database.Database): CounterSaleEntry[] {
  return db
    .prepare('SELECT * FROM counter_sale_entries WHERE bill_id IS NULL ORDER BY entry_date, id')
    .all() as CounterSaleEntry[];
}

/** Removes a mistaken entry - only while it's still pending (not on a bill). */
export function deleteCounterSaleEntry(db: Database.Database, entryId: number): void {
  const existing = db.prepare('SELECT * FROM counter_sale_entries WHERE id = ?').get(entryId) as
    | CounterSaleEntry
    | undefined;
  if (!existing) throw new Error('Entry not found');
  if (existing.bill_id !== null) throw new Error('This entry is already on a bill and can no longer be deleted');
  db.prepare('DELETE FROM counter_sale_entries WHERE id = ?').run(entryId);
}

/**
 * Turns the chosen pending entries (default: all of them) into one bill. A
 * customer can buy several items, so one bill holds many entries. The
 * bill's customer name/number are taken from the first entry that has one
 * (the form keeps them filled in across items). The bill is dated by the
 * earliest entry's date - that's what files it under the right day on the
 * Counter Sale page - with the real current time of day.
 */
export function generateCounterSaleBill(db: Database.Database, entryIds?: number[]): CounterSaleBill {
  const run = db.transaction(() => {
    const pending = listPendingCounterSaleEntries(db);
    let chosen: CounterSaleEntry[];
    if (entryIds) {
      const wanted = new Set(entryIds);
      chosen = pending.filter((e) => wanted.has(e.id));
      if (chosen.length !== wanted.size) {
        throw new Error('One or more selected entries are no longer available - please refresh and try again');
      }
    } else {
      chosen = pending;
    }
    if (chosen.length === 0) throw new Error('Add at least one item before generating a bill');

    const total = floorMoney(chosen.reduce((sum, e) => sum + e.line_total, 0));
    const earliestDate = chosen.map((e) => e.entry_date.split(' ')[0]).sort()[0];
    const billDate = `${earliestDate} ${pakistanNow().time}`;
    const customerName = chosen.find((e) => e.customer_name)?.customer_name ?? null;
    const customerNumber = chosen.find((e) => e.customer_number)?.customer_number ?? null;

    const billId = db
      .prepare('INSERT INTO counter_sale_bills (bill_date, customer_name, customer_number, total) VALUES (?, ?, ?, ?)')
      .run(billDate, customerName, customerNumber, total).lastInsertRowid as number;

    const lock = db.prepare('UPDATE counter_sale_entries SET bill_id = ? WHERE id = ?');
    for (const e of chosen) lock.run(billId, e.id);
    return billId;
  });

  return getCounterSaleBill(db, run());
}

interface BillRow {
  id: number;
  bill_date: string;
  customer_name: string | null;
  customer_number: string | null;
  total: number;
}

function toBill(db: Database.Database, row: BillRow, label: string): CounterSaleBill {
  const items = db
    .prepare('SELECT * FROM counter_sale_entries WHERE bill_id = ? ORDER BY entry_date, id')
    .all(row.id) as CounterSaleEntry[];
  return {
    id: row.id,
    bill_date: row.bill_date,
    customer_name: row.customer_name,
    customer_number: row.customer_number,
    customer_label: label,
    total: row.total,
    items,
  };
}

/**
 * Every counter-sale bill for one calendar date, oldest first. A bill with
 * no customer name is labelled "Customer 1", "Customer 2", ... counting only
 * the unnamed bills of that day in the order they were made, so named
 * customers don't eat up numbers.
 */
export function listCounterSaleBillsForDate(db: Database.Database, date: string): CounterSaleBill[] {
  if (!DATE_ONLY_RE.test(date)) throw new Error("Date must be in 'YYYY-MM-DD' format");
  const rows = db
    .prepare('SELECT * FROM counter_sale_bills WHERE date(bill_date) = ? ORDER BY bill_date, id')
    .all(date) as BillRow[];
  let unnamed = 0;
  return rows.map((row) => toBill(db, row, row.customer_name ?? `Customer ${++unnamed}`));
}

export function getCounterSaleBill(db: Database.Database, billId: number): CounterSaleBill {
  const row = db.prepare('SELECT * FROM counter_sale_bills WHERE id = ?').get(billId) as BillRow | undefined;
  if (!row) throw new Error(`Counter sale bill ${billId} not found`);
  if (row.customer_name) return toBill(db, row, row.customer_name);

  // Same numbering as the day's list, so the label on a bill matches the
  // one shown in the list it was opened from.
  const sameDay = db
    .prepare(
      `SELECT id FROM counter_sale_bills
       WHERE date(bill_date) = date(?) AND customer_name IS NULL
       ORDER BY bill_date, id`
    )
    .all(row.bill_date) as { id: number }[];
  const position = sameDay.findIndex((b) => b.id === row.id) + 1;
  return toBill(db, row, `Customer ${position}`);
}
