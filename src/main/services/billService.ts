import Database from 'better-sqlite3';
import { BillListItem, PartyType } from '../types';

export interface ListAllBillsFilter {
  partyType?: PartyType; // omit for both
  fromDate?: string; // 'YYYY-MM-DD', inclusive, matched against bill_date's date part
  toDate?: string;
}

/**
 * Every bill across both suppliers and customers, most recent first - backs
 * the global Bills screen (spec's main navigation item, distinct from the
 * per-party bill history shown on a profile page). supplier_bills and
 * customer_bills have differently-named foreign keys (supplier_id vs
 * customer_id), so this is a manual UNION ALL with an explicit column list
 * rather than `SELECT *` from each.
 */
export function listAllBills(db: Database.Database, filter: ListAllBillsFilter = {}): BillListItem[] {
  const clauses: string[] = [];
  const params: string[] = [];

  if (filter.fromDate) {
    clauses.push('date(bill_date) >= ?');
    params.push(filter.fromDate);
  }
  if (filter.toDate) {
    clauses.push('date(bill_date) <= ?');
    params.push(filter.toDate);
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const supplierSql = `
    SELECT sb.id, 'supplier' AS party_type, sb.supplier_id AS party_id, s.name AS party_name,
           sb.bill_date, sb.previous_due, sb.subtotal, sb.total_due_after_bill, sb.remaining_due
    FROM supplier_bills sb
    JOIN suppliers s ON s.id = sb.supplier_id
  `;
  const customerSql = `
    SELECT cb.id, 'customer' AS party_type, cb.customer_id AS party_id, c.name AS party_name,
           cb.bill_date, cb.previous_due, cb.subtotal, cb.total_due_after_bill, cb.remaining_due
    FROM customer_bills cb
    JOIN customers c ON c.id = cb.customer_id
  `;
  const shopkeeperSql = `
    SELECT kb.id, 'shopkeeper' AS party_type, kb.shopkeeper_id AS party_id, k.name AS party_name,
           kb.bill_date, kb.previous_due, kb.subtotal, kb.total_due_after_bill, kb.remaining_due
    FROM shopkeeper_bills kb
    JOIN shopkeepers k ON k.id = kb.shopkeeper_id
  `;

  let sql: string;
  let allParams: string[];

  if (filter.partyType === 'supplier') {
    sql = `${supplierSql} ${whereSql} ORDER BY sb.bill_date DESC, sb.id DESC`;
    allParams = params;
  } else if (filter.partyType === 'customer') {
    sql = `${customerSql} ${whereSql} ORDER BY cb.bill_date DESC, cb.id DESC`;
    allParams = params;
  } else if (filter.partyType === 'shopkeeper') {
    sql = `${shopkeeperSql} ${whereSql} ORDER BY kb.bill_date DESC, kb.id DESC`;
    allParams = params;
  } else {
    sql = `
      SELECT * FROM (
        ${supplierSql}
        UNION ALL
        ${customerSql}
        UNION ALL
        ${shopkeeperSql}
      )
      ${whereSql}
      ORDER BY bill_date DESC, id DESC
    `;
    allParams = [...params, ...params, ...params];
  }

  return db.prepare(sql).all(...allParams) as BillListItem[];
}
