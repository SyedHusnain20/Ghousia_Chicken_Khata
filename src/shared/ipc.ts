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
import type { SnapshotInfo } from '../main/backup/snapshotService';
export type { SnapshotInfo };

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
  STORAGE_GET_INFO: 'storage:get-info',
  STORAGE_CHOOSE_FOLDER: 'storage:choose-folder',
  STORAGE_CONFIRM_CHANGE: 'storage:confirm-change',
  STORAGE_CREATE_SNAPSHOT_NOW: 'storage:create-snapshot-now',
  STORAGE_OPEN_FOLDER: 'storage:open-folder',
  STORAGE_CHOOSE_RESTORE_FILE: 'storage:choose-restore-file',
  STORAGE_CONFIRM_RESTORE: 'storage:confirm-restore',
  REPORT_CUSTOMERS_CLOSING_PDF: 'report:customers-closing-pdf',
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

export interface StorageInfo {
  dbFolderPath: string;
  dbFilePath: string;
  isOneDrive: boolean; // whether dbFolderPath currently lives inside the detected OneDrive folder
  oneDriveDetectedPath: string | null; // null if OneDrive isn't set up on this laptop at all
  snapshots: SnapshotInfo[]; // newest first
}

// Result of opening the "choose a new folder" dialog. null (via the
// Promise resolving to null) means the shopkeeper cancelled the dialog.
export interface ChooseFolderResult {
  folderPath: string;
  hasExistingDatabase: boolean; // true if khata.db already exists there - renderer must confirm overwrite
}

export interface ConfirmChangeStorageRequest {
  folderPath: string;
  overwrite: boolean; // must be true if ChooseFolderResult.hasExistingDatabase was true
}

// Result of picking a file to restore from. isValid is false if the file
// doesn't look like a khata database - the renderer should show an error
// rather than letting the shopkeeper proceed with an unrelated file.
export interface ChooseRestoreFileResult {
  filePath: string;
  isValid: boolean;
}

export interface ConfirmRestoreRequest {
  filePath: string;
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
  getStorageInfo(): Promise<StorageInfo>;
  // Opens a native folder-picker dialog. Resolves to null if cancelled.
  chooseStorageFolder(): Promise<ChooseFolderResult | null>;
  // Moves the live database to the new folder, saves it as the new
  // location, then restarts the app. The renderer's promise will never
  // resolve in the success case - the app quits before it can reply.
  confirmChangeStorageLocation(req: ConfirmChangeStorageRequest): Promise<void>;
  createSnapshotNow(): Promise<SnapshotInfo>;
  openStorageFolder(): Promise<void>;
  // Opens a native file-picker filtered to .db files, defaulting to the
  // Snapshots folder. Resolves to null if cancelled.
  chooseRestoreFile(): Promise<ChooseRestoreFileResult | null>;
  // Restores from the given file, safety-copying current data first, then
  // restarts the app. As with confirmChangeStorageLocation, the promise
  // never resolves in the success case.
  confirmRestore(req: ConfirmRestoreRequest): Promise<void>;
  // Builds the customer closing report, prompts for a save location, and
  // opens the resulting PDF. Resolves to the saved file path, or null if
  // the shopkeeper cancelled the save dialog.
  generateCustomersClosingPdf(): Promise<string | null>;
}