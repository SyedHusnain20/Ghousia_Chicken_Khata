export type PartyType = 'supplier' | 'customer';

export interface Party {
  id: number;
  name: string;
  contact_number: string | null;
  opening_due: number;
  current_due: number;
  created_at: string;
}

export interface Entry {
  id: number;
  entry_date: string;
  item_name: string;
  weight_kg: number;
  rate_per_kg: number;
  line_total: number;
  bill_id: number | null;
}

export interface Bill {
  id: number;
  bill_date: string;
  previous_due: number;
  subtotal: number;
  total_due_after_bill: number;
  remaining_due: number;
  items: Entry[];
}

// One row in a bill-history list (profile page or the global Bills
// screen). No items here - just enough to show a scannable list and link
// through to the full printable bill via getBillById.
export interface BillListItem {
  id: number;
  party_type: PartyType;
  party_id: number;
  party_name: string;
  bill_date: string;
  previous_due: number;
  subtotal: number;
  total_due_after_bill: number;
  remaining_due: number;
}

// The full record behind a printable bill: the bill row, its locked-in
// items, and enough party info to put a name/contact on the receipt
// without a second round trip.
export interface BillDetail extends Bill {
  party_type: PartyType;
  party_id: number;
  party_name: string;
  party_contact: string | null;
}

export interface Payment {
  id: number;
  party_type: PartyType;
  party_id: number;
  bill_id: number | null;
  amount: number;
  paid_at: string;
  note: string | null;
}

// An entry with its party's name attached - used for daily ledger line
// items, where "Ali - 70kg x 380" needs to be shown without a separate
// lookup per row.
export interface EntryWithPartyName extends Entry {
  party_id: number;
  party_name: string;
}

export interface DailyLedger {
  id: number;
  ledger_date: string; // 'YYYY-MM-DD'
  cash_customer_income: number;
  extra_expenses: number;
  created_at: string;
  updated_at: string;
}

// The full view shown on the Daily Ledger page: the manual fields plus
// everything derived live from supplier_entries/customer_entries for that
// date. supplier_purchases_total and khata_sales_total are NEVER stored -
// they're always recomputed from the entries so there's no way for them to
// drift out of sync with the Supplier/Customer modules.
export interface DailyLedgerDetail extends DailyLedger {
  supplier_purchases: EntryWithPartyName[];
  khata_sales: EntryWithPartyName[];
  supplier_purchases_total: number;
  khata_sales_total: number;
  total_income: number;
  total_expenses: number;
  profit_loss: number;
}

// One row in the Daily Ledger history list / monthly summary.
export interface DailyLedgerSummary {
  ledger_date: string;
  total_income: number;
  total_expenses: number;
  profit_loss: number;
}