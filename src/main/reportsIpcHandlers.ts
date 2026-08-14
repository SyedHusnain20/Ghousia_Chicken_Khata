import { ipcMain, BrowserWindow } from 'electron';
import Database from 'better-sqlite3';
import { IpcChannels } from '../shared/ipc';
import { generateCustomersClosingPdf } from './reports/customersClosingReport';

export function registerReportIpcHandlers(getDb: () => Database.Database, getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IpcChannels.REPORT_CUSTOMERS_CLOSING_PDF, () => {
    return generateCustomersClosingPdf(getDb(), getMainWindow());
  });
}
