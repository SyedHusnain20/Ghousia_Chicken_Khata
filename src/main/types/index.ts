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

export interface Payment {
  id: number;
  party_type: PartyType;
  party_id: number;
  bill_id: number | null;
  amount: number;
  paid_at: string;
  note: string | null;
}
