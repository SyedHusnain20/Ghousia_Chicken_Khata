import { ipcMain } from 'electron';
import Database from 'better-sqlite3';
import { IpcChannels } from '../shared/ipc';
import type {
  CreatePartyRequest,
  GetPartyRequest,
  ListPartiesRequest,
  AddEntryRequest,
  ListUnbilledEntriesRequest,
  GenerateBillRequest,
  RecordPaymentRequest,
  CreateDailyLedgerRequest,
  GetDailyLedgerRequest,
  UpdateDailyLedgerFieldsRequest,
  ListDailyLedgersRequest,
  GetMonthlySummaryRequest,
} from '../shared/ipc';
import {
  createParty,
  getParty,
  getAllParties,
  addEntry,
  getUnbilledEntries,
  generateBill,
  recordPayment,
} from './services/partyService';
import {
  createDailyLedger,
  getDailyLedger,
  updateDailyLedgerFields,
  listDailyLedgers,
  getMonthlySummary,
} from './services/dailyLedgerService';

/**
 * Wires every khata:* IPC channel to the corresponding service function.
 * All the service functions are synchronous (better-sqlite3 is sync under
 * the hood), so handlers just call straight through - ipcMain.handle()
 * takes care of turning a thrown Error into a rejected promise on the
 * renderer side, so callers there just get a normal try/catch.
 *
 * Call this once, after the database has been opened, before any window
 * is created.
 */
export function registerIpcHandlers(db: Database.Database): void {
  ipcMain.handle(IpcChannels.PARTY_CREATE, (_event, req: CreatePartyRequest) => {
    return createParty(db, req.partyType, req.name, req.contactNumber, req.openingDue ?? 0);
  });

  ipcMain.handle(IpcChannels.PARTY_GET, (_event, req: GetPartyRequest) => {
    return getParty(db, req.partyType, req.partyId);
  });

  ipcMain.handle(IpcChannels.PARTY_LIST, (_event, req: ListPartiesRequest) => {
    return getAllParties(db, req.partyType);
  });

  ipcMain.handle(IpcChannels.ENTRY_ADD, (_event, req: AddEntryRequest) => {
    return addEntry(db, req.partyType, req.partyId, req.itemName, req.weightKg, req.ratePerKg, req.entryDate);
  });

  ipcMain.handle(IpcChannels.ENTRY_LIST_UNBILLED, (_event, req: ListUnbilledEntriesRequest) => {
    return getUnbilledEntries(db, req.partyType, req.partyId);
  });

  ipcMain.handle(IpcChannels.BILL_GENERATE, (_event, req: GenerateBillRequest) => {
    return generateBill(db, req.partyType, req.partyId, req.paymentNow ?? 0);
  });

  ipcMain.handle(IpcChannels.PAYMENT_RECORD, (_event, req: RecordPaymentRequest) => {
    return recordPayment(db, req.partyType, req.partyId, req.amount, req.billId ?? null, req.note ?? null);
  });

  ipcMain.handle(IpcChannels.DAILY_LEDGER_CREATE, (_event, req: CreateDailyLedgerRequest) => {
    return createDailyLedger(db, req.ledgerDate);
  });

  ipcMain.handle(IpcChannels.DAILY_LEDGER_GET, (_event, req: GetDailyLedgerRequest) => {
    return getDailyLedger(db, req.ledgerDate);
  });

  ipcMain.handle(IpcChannels.DAILY_LEDGER_UPDATE_FIELDS, (_event, req: UpdateDailyLedgerFieldsRequest) => {
    return updateDailyLedgerFields(db, req.ledgerDate, req.cashCustomerIncome ?? 0, req.extraExpenses ?? 0);
  });

  ipcMain.handle(IpcChannels.DAILY_LEDGER_LIST, (_event, req: ListDailyLedgersRequest) => {
    return listDailyLedgers(db, req.fromDate, req.toDate);
  });

  ipcMain.handle(IpcChannels.DAILY_LEDGER_MONTHLY_SUMMARY, (_event, req: GetMonthlySummaryRequest) => {
    return getMonthlySummary(db, req.year, req.month);
  });
}

/**
 * Removes all handlers registered above. Mainly useful for tests that spin
 * up/tear down the app repeatedly in the same process.
 */
export function unregisterIpcHandlers(): void {
  Object.values(IpcChannels).forEach((channel) => ipcMain.removeHandler(channel));
}