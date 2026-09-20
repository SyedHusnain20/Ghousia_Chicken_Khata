import { ipcMain } from 'electron';
import { guardedHandle } from './security/ipcGuard';
import Database from 'better-sqlite3';
import { IpcChannels } from '../shared/ipc';
import type {
  CreatePartyRequest,
  GetPartyRequest,
  ListPartiesRequest,
  DeletePartyRequest,
  ForceDeletePartyRequest,
  AddEntryRequest,
  UpdateEntryRequest,
  DeleteEntryRequest,
  ListUnbilledEntriesRequest,
  GenerateBillRequest,
  ListBillsForPartyRequest,
  GetBillRequest,
  RestoreBillRequest,
  ListAllBillsRequest,
  RecordPaymentRequest,
  ListPaymentsRequest,
  ListUnbilledPaymentsRequest,
  CreateDailyLedgerRequest,
  GetDailyLedgerRequest,
  UpdateDailyLedgerFieldsRequest,
  SaveDailyLedgerUdharsRequest,
  ListDailyLedgersRequest,
  GetMonthlySummaryRequest,
} from '../shared/ipc';
import {
  createParty,
  getParty,
  getAllParties,
  getAllPartiesWithActivity,
  deleteParty,
  forceDeleteParty,
  addEntry,
  updateEntry,
  deleteEntry,
  getUnbilledEntries,
  getUnbilledPayments,
  generateBill,
  restoreBill,
  getBillsForParty,
  getBillById,
  recordPayment,
  getPayments,
} from './services/partyService';
import { listAllBills } from './services/billService';
import {
  createDailyLedger,
  getDailyLedger,
  updateDailyLedgerFields,
  saveDailyLedgerUdhars,
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
  guardedHandle(IpcChannels.PARTY_CREATE, (_event, req: CreatePartyRequest) => {
    return createParty(db, req.partyType, req.name, req.contactNumber, req.openingDue ?? 0);
  });

  guardedHandle(IpcChannels.PARTY_GET, (_event, req: GetPartyRequest) => {
    return getParty(db, req.partyType, req.partyId);
  });

  guardedHandle(IpcChannels.PARTY_LIST, (_event, req: ListPartiesRequest) => {
    return getAllParties(db, req.partyType);
  });

  guardedHandle(IpcChannels.PARTY_LIST_WITH_ACTIVITY, (_event, req: ListPartiesRequest) => {
    return getAllPartiesWithActivity(db, req.partyType);
  });

  guardedHandle(IpcChannels.PARTY_DELETE, (_event, req: DeletePartyRequest) => {
    deleteParty(db, req.partyType, req.partyId);
  });

  guardedHandle(IpcChannels.PARTY_FORCE_DELETE, (_event, req: ForceDeletePartyRequest) => {
    forceDeleteParty(db, req.partyType, req.partyId, req.confirmName);
  });

  guardedHandle(IpcChannels.ENTRY_ADD, (_event, req: AddEntryRequest) => {
    return addEntry(
      db,
      req.partyType,
      req.partyId,
      req.itemName,
      req.weightKg,
      req.ratePerKg,
      req.entryDate,
      req.confirmDuplicate ?? false
    );
  });

  guardedHandle(IpcChannels.ENTRY_UPDATE, (_event, req: UpdateEntryRequest) => {
    updateEntry(db, req.partyType, req.partyId, req.entryId, req.itemName, req.weightKg, req.ratePerKg, req.entryDate);
  });

  guardedHandle(IpcChannels.ENTRY_DELETE, (_event, req: DeleteEntryRequest) => {
    deleteEntry(db, req.partyType, req.partyId, req.entryId);
  });

  guardedHandle(IpcChannels.ENTRY_LIST_UNBILLED, (_event, req: ListUnbilledEntriesRequest) => {
    return getUnbilledEntries(db, req.partyType, req.partyId);
  });

  guardedHandle(IpcChannels.BILL_GENERATE, (_event, req: GenerateBillRequest) => {
    return generateBill(db, req.partyType, req.partyId, req.entryIds, req.paymentIds, req.confirmDuplicates ?? false);
  });

  guardedHandle(IpcChannels.PAYMENT_LIST_UNBILLED, (_event, req: ListUnbilledPaymentsRequest) => {
    return getUnbilledPayments(db, req.partyType, req.partyId);
  });

  guardedHandle(IpcChannels.PAYMENT_RECORD, (_event, req: RecordPaymentRequest) => {
    return recordPayment(
      db,
      req.partyType,
      req.partyId,
      req.amount,
      req.billId ?? null,
      req.note ?? null,
      req.paymentMethod ?? null,
      req.paymentDate
    );
  });

  guardedHandle(IpcChannels.BILL_LIST_FOR_PARTY, (_event, req: ListBillsForPartyRequest) => {
    return getBillsForParty(db, req.partyType, req.partyId);
  });

  guardedHandle(IpcChannels.BILL_GET, (_event, req: GetBillRequest) => {
    return getBillById(db, req.partyType, req.billId);
  });

  guardedHandle(IpcChannels.BILL_RESTORE, (_event, req: RestoreBillRequest) => {
    return restoreBill(db, req.partyType, req.billId);
  });

  guardedHandle(IpcChannels.BILL_LIST_ALL, (_event, req: ListAllBillsRequest) => {
    return listAllBills(db, { partyType: req.partyType, fromDate: req.fromDate, toDate: req.toDate });
  });

  guardedHandle(IpcChannels.PAYMENT_LIST, (_event, req: ListPaymentsRequest) => {
    return getPayments(db, req.partyType, req.partyId);
  });

  guardedHandle(IpcChannels.DAILY_LEDGER_CREATE, (_event, req: CreateDailyLedgerRequest) => {
    return createDailyLedger(db, req.ledgerDate);
  });

  guardedHandle(IpcChannels.DAILY_LEDGER_GET, (_event, req: GetDailyLedgerRequest) => {
    return getDailyLedger(db, req.ledgerDate);
  });

  guardedHandle(IpcChannels.DAILY_LEDGER_UPDATE_FIELDS, (_event, req: UpdateDailyLedgerFieldsRequest) => {
    const hasLiveChickenInput =
      req.liveChickenWeightKg !== undefined || req.liveChickenRate !== undefined || req.liveChickenTotal !== undefined;
    const hasChickenMeatInput =
      req.chickenMeatWeightKg !== undefined || req.chickenMeatRate !== undefined || req.chickenMeatTotal !== undefined;
    const hasLeverInput = req.leverWeightKg !== undefined || req.leverRate !== undefined || req.leverTotal !== undefined;

    return updateDailyLedgerFields(db, req.ledgerDate, {
      saleIncome: req.saleIncome,
      extraExpenses: req.extraExpenses,
      liveChicken: hasLiveChickenInput
        ? { weightKg: req.liveChickenWeightKg, rate: req.liveChickenRate, totalAmount: req.liveChickenTotal }
        : undefined,
      chickenMeat: hasChickenMeatInput
        ? { weightKg: req.chickenMeatWeightKg, rate: req.chickenMeatRate, totalAmount: req.chickenMeatTotal }
        : undefined,
      lever: hasLeverInput ? { weightKg: req.leverWeightKg, rate: req.leverRate, totalAmount: req.leverTotal } : undefined,
    });
  });

  guardedHandle(IpcChannels.DAILY_LEDGER_SAVE_UDHARS, (_event, req: SaveDailyLedgerUdharsRequest) => {
    return saveDailyLedgerUdhars(db, req.ledgerDate, req.udhars);
  });

  guardedHandle(IpcChannels.DAILY_LEDGER_LIST, (_event, req: ListDailyLedgersRequest) => {
    return listDailyLedgers(db, req.fromDate, req.toDate);
  });

  guardedHandle(IpcChannels.DAILY_LEDGER_MONTHLY_SUMMARY, (_event, req: GetMonthlySummaryRequest) => {
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

// Re-exported so tests that both call registerStorageIpcHandlers() and
// this file's registerIpcHandlers() only need one teardown call - see
// unregisterIpcHandlers() above, which already iterates every channel in
// IpcChannels (including the storage:* ones added there).