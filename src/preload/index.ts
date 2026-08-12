import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, KhataApi } from '../shared/ipc';

// This is the ONLY thing the renderer can touch. No direct ipcRenderer
// access, no Node globals - just the functions below, each mapped to one
// channel. If the UI needs something new, it gets added here explicitly
// rather than the renderer reaching for a broader API.
const khataApi: KhataApi = {
  createParty: (req) => ipcRenderer.invoke(IpcChannels.PARTY_CREATE, req),
  getParty: (req) => ipcRenderer.invoke(IpcChannels.PARTY_GET, req),
  listParties: (req) => ipcRenderer.invoke(IpcChannels.PARTY_LIST, req),
  addEntry: (req) => ipcRenderer.invoke(IpcChannels.ENTRY_ADD, req),
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
};

contextBridge.exposeInMainWorld('khata', khataApi);