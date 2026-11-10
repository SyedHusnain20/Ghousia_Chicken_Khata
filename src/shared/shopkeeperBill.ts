import type { BillDetail, Entry } from '../main/types';

// Shopkeepers can be both bought from (purchase) and sold to (sale), so
// their bill is laid out differently from every other party's: all sales,
// then all purchases, then a summary. This file holds the arithmetic and
// wording both renderings of that bill (on-screen/print in the renderer,
// and the WhatsApp image in the main process) agree on, so the two can't
// drift apart.
//
// Sign convention (same as every party's current_due): positive = the shop
// OWES the party, negative = the party owes the SHOP. For a shopkeeper that
// reads as: purchases push the due up, sales pull it down.

export interface ShopkeeperBillSummary {
  sales: Entry[];
  purchases: Entry[];
  totalSale: number;
  totalPurchase: number;
}

export function summarizeShopkeeperBill(bill: Pick<BillDetail, 'items'>): ShopkeeperBillSummary {
  const sales = bill.items.filter((e) => e.entry_type === 'sale');
  // Entries logged before sales existed have no entry_type - they're purchases.
  const purchases = bill.items.filter((e) => e.entry_type !== 'sale');
  return {
    sales,
    purchases,
    totalSale: Math.floor(sales.reduce((s, e) => s + e.line_total, 0)),
    totalPurchase: Math.floor(purchases.reduce((s, e) => s + e.line_total, 0)),
  };
}

export type BalanceKind = 'receivable' | 'payable' | 'clear';

// due > 0: shop owes the shopkeeper  -> "payable"   (shown red)
// due < 0: shopkeeper owes the shop  -> "receivable" (shown green)
export function shopkeeperBalance(due: number): { kind: BalanceKind; amount: number } {
  const floored = Math.floor(due);
  if (floored === 0) return { kind: 'clear', amount: 0 };
  if (floored > 0) return { kind: 'payable', amount: floored };
  return { kind: 'receivable', amount: Math.abs(floored) };
}

export const BALANCE_WORDS: Record<BalanceKind, string> = {
  receivable: 'Receivable (they owe you)',
  payable: 'Payable (you owe them)',
  clear: 'Settled',
};
