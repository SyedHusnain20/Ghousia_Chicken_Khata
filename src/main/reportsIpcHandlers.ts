import type { BrowserWindow } from 'electron';
import { guardedHandle } from './security/ipcGuard';
import Database from 'better-sqlite3';
import { IpcChannels } from '../shared/ipc';
import type { ShareBillImageRequest } from '../shared/ipc';
import { generateCustomersClosingPdf } from './reports/customersClosingReport';
import { shareBillAsImage } from './reports/billImageShare';

export function registerReportIpcHandlers(getDb: () => Database.Database, getMainWindow: () => BrowserWindow | null): void {
  guardedHandle(IpcChannels.REPORT_CUSTOMERS_CLOSING_PDF, () => {
    return generateCustomersClosingPdf(getDb(), getMainWindow());
  });

  guardedHandle(IpcChannels.REPORT_SHARE_BILL_IMAGE, (_event, req: ShareBillImageRequest) => {
    return shareBillAsImage(getDb(), req.partyType, req.billId);
  });
}
