import {
  PartyType,
  Party,
  Entry,
  Bill,
  BillListItem,
  BillDetail,
  Payment,
  DailyLedger,
  DailyLedgerDetail,
  DailyLedgerSummary,
} from '../main/types';

// Centralized channel names so main and preload never drift out of sync
// (a typo here fails loudly at compile time instead of silently at runtime).
export const IpcChannels = {
  PARTY_CREATE: 'party:create',
  PARTY_GET: 'party:get',
  PARTY_LIST: 'party:list',
  ENTRY_ADD: 'entry:add',
  ENTRY_LIST_UNBILLED: 'entry:list-unbilled',
  BILL_GENERATE: 'bill:generate',
  BILL_LIST_FOR_PARTY: 'bill:list-for-party',
  BILL_GET: 'bill:get',
  BILL_LIST_ALL: 'bill:list-all',
  PAYMENT_RECORD: 'payment:record',
  PAYMENT_LIST: 'payment:list',
  DAILY_LEDGER_CREATE: 'daily-ledger:create',
  DAILY_LEDGER_GET: 'daily-ledger:get',
  DAILY_LEDGER_UPDATE_FIELDS: 'daily-ledger:update-fields',
  DAILY_LEDGER_LIST: 'daily-ledger:list',
  DAILY_LEDGER_MONTHLY_SUMMARY: 'daily-ledger:monthly-summary',
} as const;

export interface CreatePartyRequest {
  partyType: PartyType;
  name: string;
  contactNumber: string | null;
  openingDue?: number;
}

export interface GetPartyRequest {
  partyType: PartyType;
  partyId: number;
}

export interface ListPartiesRequest {
  partyType: PartyType;
}

export interface AddEntryRequest {
  partyType: PartyType;
  partyId: number;
  itemName: string;
  weightKg: number;
  ratePerKg: number;
  entryDate?: string; // 'YYYY-MM-DD' - omit to use today
}

export interface ListUnbilledEntriesRequest {
  partyType: PartyType;
  partyId: number;
}

export interface GenerateBillRequest {
  partyType: PartyType;
  partyId: number;
  paymentNow?: number;
}

export interface RecordPaymentRequest {
  partyType: PartyType;
  partyId: number;
  amount: number;
  billId?: number | null;
  note?: string | null;
}

export interface ListPaymentsRequest {
  partyType: PartyType;
  partyId: number;
}

export interface ListBillsForPartyRequest {
  partyType: PartyType;
  partyId: number;
}

export interface GetBillRequest {
  partyType: PartyType;
  billId: number;
}

export interface ListAllBillsRequest {
  partyType?: PartyType;
  fromDate?: string;
  toDate?: string;
}

export interface CreateDailyLedgerRequest {
  ledgerDate: string; // 'YYYY-MM-DD'
}

export interface GetDailyLedgerRequest {
  ledgerDate: string;
}

export interface UpdateDailyLedgerFieldsRequest {
  ledgerDate: string;
  cashCustomerIncome?: number;
  extraExpenses?: number;
}

export interface ListDailyLedgersRequest {
  fromDate?: string;
  toDate?: string;
}

export interface GetMonthlySummaryRequest {
  year: number;
  month: number; // 1-12
}

export interface MonthlySummary {
  total_income: number;
  total_expenses: number;
  total_profit_loss: number;
}

/**
 * The full surface exposed to the renderer via contextBridge as
 * `window.khata`. Keeping this interface here means the renderer (once it
 * exists in Phase 3) can import it purely for typing, with no risk of
 * pulling in main-process code (electron, better-sqlite3, fs) into the
 * browser bundle.
 */
export interface KhataApi {
  createParty(req: CreatePartyRequest): Promise<number>;
  getParty(req: GetPartyRequest): Promise<Party>;
  listParties(req: ListPartiesRequest): Promise<Party[]>;
  addEntry(req: AddEntryRequest): Promise<number>;
  listUnbilledEntries(req: ListUnbilledEntriesRequest): Promise<Entry[]>;
  generateBill(req: GenerateBillRequest): Promise<Bill>;
  listBillsForParty(req: ListBillsForPartyRequest): Promise<BillListItem[]>;
  getBill(req: GetBillRequest): Promise<BillDetail>;
  listAllBills(req: ListAllBillsRequest): Promise<BillListItem[]>;
  recordPayment(req: RecordPaymentRequest): Promise<Payment>;
  listPayments(req: ListPaymentsRequest): Promise<Payment[]>;
  createDailyLedger(req: CreateDailyLedgerRequest): Promise<DailyLedger>;
  getDailyLedger(req: GetDailyLedgerRequest): Promise<DailyLedgerDetail>;
  updateDailyLedgerFields(req: UpdateDailyLedgerFieldsRequest): Promise<DailyLedger>;
  listDailyLedgers(req: ListDailyLedgersRequest): Promise<DailyLedgerSummary[]>;
  getMonthlySummary(req: GetMonthlySummaryRequest): Promise<MonthlySummary>;
}