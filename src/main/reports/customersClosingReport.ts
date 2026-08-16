import { app, BrowserWindow, dialog, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getAllParties, pakistanNow, floorMoney } from '../services/partyService';
import type { Party } from '../types';

// Mirrors src/renderer/shopConfig.ts - kept as a local constant rather than
// importing across the main/renderer boundary (they're compiled as two
// separate TypeScript projects; see tsconfig.json's renderer exclusion).
const SHOP_NAME_EN = 'Ghousia Chicken Shop';

const money = new Intl.NumberFormat('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
function formatRs(amount: number): string {
  return `Rs. ${money.format(floorMoney(amount))}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildClosingReportHtml(customers: Party[], generatedAt: string): string {
  const totalDue = customers.reduce((sum, c) => sum + c.current_due, 0);

  const rows = customers
    .map(
      (c) => `
      <tr>
        <td class="name">${escapeHtml(c.name)}</td>
        <td class="amount">${formatRs(c.current_due)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #2a2420;
    margin: 0;
    padding: 32px 40px;
  }
  h1 {
    font-size: 20px;
    margin: 0 0 2px 0;
  }
  .subtitle {
    font-size: 12px;
    color: #6b6259;
    margin-bottom: 24px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th, td {
    padding: 8px 10px;
    text-align: left;
    border-bottom: 1px solid #ddd6cc;
    font-size: 13px;
  }
  th {
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.4px;
    color: #6b6259;
    background: #f4efe6;
  }
  td.amount, th.amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  tfoot td {
    font-weight: 700;
    border-top: 2px solid #2a2420;
    border-bottom: none;
  }
  .footer {
    margin-top: 28px;
    font-size: 10.5px;
    color: #8a8177;
    text-align: center;
  }
</style>
</head>
<body>
  <h1>${escapeHtml(SHOP_NAME_EN)} \u2014 Customer Closing</h1>
  <div class="subtitle">Generated ${escapeHtml(generatedAt)} &middot; ${customers.length} customer${customers.length === 1 ? '' : 's'}</div>
  <table>
    <thead>
      <tr><th>Name</th><th class="amount">Total Amount</th></tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="2" style="text-align:center;color:#8a8177;">No customers yet</td></tr>'}</tbody>
    <tfoot>
      <tr><td>Total</td><td class="amount">${formatRs(totalDue)}</td></tr>
    </tfoot>
  </table>
  <div class="footer">
    <div>Powered by R&amp;R Digital Solutions</div>
    <div>Contact: 03126641281</div>
  </div>
</body>
</html>`;
}

/**
 * Renders the report HTML in a hidden, throw-away window and returns the
 * generated PDF as a Buffer. A separate window (rather than printing the
 * app's own visible window) means this never has to fight the main app's
 * on-screen layout or the thermal-receipt print styles.
 */
async function renderHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const hiddenWindow = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: false },
  });
  try {
    await hiddenWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await hiddenWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }, // padding is handled in the HTML/CSS itself
    });
  } finally {
    hiddenWindow.destroy();
  }
}

/**
 * Full "Closing" flow: builds the report, asks where to save it, writes
 * the file, and opens it in the OS's default PDF viewer. Returns the saved
 * path, or null if the shopkeeper cancelled the save dialog (nothing is
 * written in that case).
 */
export async function generateCustomersClosingPdf(
  db: Database.Database,
  parentWindow: BrowserWindow | null
): Promise<string | null> {
  const customers = getAllParties(db, 'customer');
  const now = pakistanNow();
  const generatedAt = `${now.date} ${now.time}`;
  const html = buildClosingReportHtml(customers, generatedAt);
  const pdfBuffer = await renderHtmlToPdfBuffer(html);

  const defaultFileName = `Customers Closing - ${now.date}.pdf`;
  const saveOptions = {
    title: 'Save Customer Closing PDF',
    defaultPath: path.join(app.getPath('documents'), defaultFileName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  };
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, saveOptions)
    : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || !result.filePath) return null;

  fs.writeFileSync(result.filePath, pdfBuffer);
  shell.openPath(result.filePath).catch(() => {
    // Non-fatal - the file is saved either way; the shopkeeper can still
    // find and open it manually if the OS declines to auto-open it.
  });

  return result.filePath;
}
