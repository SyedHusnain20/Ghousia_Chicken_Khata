import { contextBridge, ipcRenderer } from 'electron';
import type { KhataApi } from '../shared/ipc';

// NOTE: sandbox:true (set in main/index.ts, default since Electron 20) means
// this preload script's require() only understands a small Electron/Node
// whitelist - it CANNOT require local project files like '../shared/ipc' at
// runtime. Importing IpcChannels as a value here would silently fail to
// load the whole preload script, leaving window.khata undefined in the
// renderer. So the channel names are duplicated here as string literals
// (kept in sync with shared/ipc.ts's IpcChannels), and only the *type*
// KhataApi is imported above, which TypeScript erases at compile time.
const IpcChannels = {
  PARTY_CREATE: 'party:create',
  PARTY_GET: 'party:get',
  PARTY_LIST: 'party:list',
  PARTY_DELETE: 'party:delete',
  ENTRY_ADD: 'entry:add',
  ENTRY_UPDATE: 'entry:update',
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
  REPORT_SHARE_BILL_IMAGE: 'report:share-bill-image',
} as const;

// This is the ONLY thing the renderer can touch. No direct ipcRenderer
// access, no Node globals - just the functions below, each mapped to one
// channel. If the UI needs something new, it gets added here explicitly
// rather than the renderer reaching for a broader API.
const khataApi: KhataApi = {
  createParty: (req) => ipcRenderer.invoke(IpcChannels.PARTY_CREATE, req),
  getParty: (req) => ipcRenderer.invoke(IpcChannels.PARTY_GET, req),
  listParties: (req) => ipcRenderer.invoke(IpcChannels.PARTY_LIST, req),
  deleteParty: (req) => ipcRenderer.invoke(IpcChannels.PARTY_DELETE, req),
  addEntry: (req) => ipcRenderer.invoke(IpcChannels.ENTRY_ADD, req),
  updateEntry: (req) => ipcRenderer.invoke(IpcChannels.ENTRY_UPDATE, req),
  listUnbilledEntries: (req) => ipcRenderer.invoke(IpcChannels.ENTRY_LIST_UNBILLED, req),
  generateBill: (req) => ipcRenderer.invoke(IpcChannels.BILL_GENERATE, req),
  listBillsForParty: (req) => ipcRenderer.invoke(IpcChannels.BILL_LIST_FOR_PARTY, req),
  getBill: (req) => ipcRenderer.invoke(IpcChannels.BILL_GET, req),
  listAllBills: (req) => ipcRenderer.invoke(IpcChannels.BILL_LIST_ALL, req),
  recordPayment: (req) => ipcRenderer.invoke(IpcChannels.PAYMENT_RECORD, req),
  listPayments: (req) => ipcRenderer.invoke(IpcChannels.PAYMENT_LIST, req),
  createDailyLedger: (req) => ipcRenderer.invoke(IpcChannels.DAILY_LEDGER_CREATE, req),
  getDailyLedger: (req) => ipcRenderer.invoke(IpcChannels.DAILY_LEDGER_GET, req),
  updateDailyLedgerFields: (req) => ipcRenderer.invoke(IpcChannels.DAILY_LEDGER_UPDATE_FIELDS, req),
  listDailyLedgers: (req) => ipcRenderer.invoke(IpcChannels.DAILY_LEDGER_LIST, req),
  getMonthlySummary: (req) => ipcRenderer.invoke(IpcChannels.DAILY_LEDGER_MONTHLY_SUMMARY, req),
  getStorageInfo: () => ipcRenderer.invoke(IpcChannels.STORAGE_GET_INFO),
  chooseStorageFolder: () => ipcRenderer.invoke(IpcChannels.STORAGE_CHOOSE_FOLDER),
  confirmChangeStorageLocation: (req) => ipcRenderer.invoke(IpcChannels.STORAGE_CONFIRM_CHANGE, req),
  createSnapshotNow: () => ipcRenderer.invoke(IpcChannels.STORAGE_CREATE_SNAPSHOT_NOW),
  openStorageFolder: () => ipcRenderer.invoke(IpcChannels.STORAGE_OPEN_FOLDER),
  chooseRestoreFile: () => ipcRenderer.invoke(IpcChannels.STORAGE_CHOOSE_RESTORE_FILE),
  confirmRestore: (req) => ipcRenderer.invoke(IpcChannels.STORAGE_CONFIRM_RESTORE, req),
  generateCustomersClosingPdf: () => ipcRenderer.invoke(IpcChannels.REPORT_CUSTOMERS_CLOSING_PDF),
  shareBillImage: (req) => ipcRenderer.invoke(IpcChannels.REPORT_SHARE_BILL_IMAGE, req),
};

contextBridge.exposeInMainWorld('khata', khataApi);