import { app, BrowserWindow, clipboard, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getBillById } from '../services/partyService';
import type { BillDetail, PartyType } from '../types';

// Mirrors src/renderer/shopConfig.ts - kept as local constants rather than
// importing across the main/renderer boundary (two separate TypeScript
// projects; see tsconfig.json's renderer exclusion). Same approach as
// customersClosingReport.ts.
const SHOP_NAME_EN = 'Ghousia Chicken Shop';
const SHOP_NAME_UR = '\u063A\u0648\u062B\u06CC\u06C1 \u0686\u06A9\u0646 \u0634\u0627\u067E';

const money = new Intl.NumberFormat('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
function formatRs(amount: number): string {
  return `Rs. ${money.format(Math.floor(amount))}`;
}

function formatDate(raw: string): string {
  const datePart = raw.split(' ')[0];
  const [y, m, d] = datePart.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(raw: string): string {
  const [datePart, timePart] = raw.split(' ');
  if (!timePart) return formatDate(raw);
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh, mm);
  return `${formatDate(raw)}, ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

// Short, no-year form (e.g. '03-09') for per-row dates - the year is shown
// once in the header meta above instead of repeating on every row.
function formatDateShort(raw: string): string {
  const datePart = raw.split(' ')[0];
  const [, m, d] = datePart.split('-');
  return `${d}-${m}`;
}

const PAYMENT_METHOD_LABEL: Record<string, string> = { cash: 'Cash', online: 'Online' };

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const TITLE: Record<PartyType, string> = {
  supplier: 'Supplier Bill',
  customer: 'Customer Bill',
  shopkeeper: 'Shopkeeper Bill',
};

const PARTY_LABEL: Record<PartyType, string> = { supplier: 'Supplier', customer: 'Customer', shopkeeper: 'Shopkeeper' };

// Deliberately mirrors src/renderer/style.css's .receipt* rules and color
// tokens as closely as possible, so the shared image looks like the same
// bill the shopkeeper sees and prints in-app - just rendered standalone,
// since main can't reuse renderer CSS/DOM code directly (see
// tsconfig.json's renderer exclusion).
function buildBillHtml(bill: BillDetail): string {
  const paidTotal = Math.floor(bill.payments.reduce((sum, p) => sum + p.amount, 0));

  const itemRows = bill.items
    .map(
      (item) => `
      <tr>
        <td>${formatDateShort(item.entry_date)}</td>
        <td>${escapeHtml(item.item_name)}</td>
        <td class="num">${item.weight_kg}</td>
        <td class="num">${formatRs(item.rate_per_kg)}</td>
        <td class="num">${formatRs(item.line_total)}</td>
      </tr>`
    )
    .join('');

  const paymentRows = bill.payments
    .map(
      (payment) => `
      <tr>
        <td>${formatDateShort(payment.paid_at)}</td>
        <td>${payment.payment_method ? PAYMENT_METHOD_LABEL[payment.payment_method] : '\u2014'}</td>
        <td class="num">${formatRs(payment.amount)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #FFFFFF;
  }
  body {
    font-family: Consolas, 'Courier New', monospace;
    font-size: 13.5px;
    color: #2A2520;
    padding: 26px 24px;
    width: 380px;
  }
  .header {
    text-align: center;
    border-bottom: 1px dashed #DED4B8;
    padding-bottom: 14px;
    margin-bottom: 14px;
  }
  .shop-ur {
    font-family: 'Segoe UI', 'Jameel Noori Nastaleeq', sans-serif;
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 2px;
    direction: rtl;
  }
  .shop-en {
    font-family: Georgia, serif;
    font-size: 14px;
    color: #746A58;
  }
  .title {
    margin-top: 8px;
    font-family: 'Segoe UI', sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #7A2E2E;
    font-weight: 700;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 14px;
    font-size: 12.5px;
  }
  .meta-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .meta-row span:first-child {
    color: #746A58;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 14px;
    font-size: 12.5px;
  }
  th {
    text-align: left;
    font-size: 10.5px;
    text-transform: uppercase;
    color: #746A58;
    border-bottom: 1px solid #DED4B8;
    padding: 5px 4px;
  }
  th.num, td.num {
    text-align: right;
  }
  td {
    padding: 5px 4px;
    border-bottom: 1px dotted #DED4B8;
  }
  .payments-table {
    margin-top: -6px;
    padding-top: 8px;
    border-top: 1px dashed #DED4B8;
  }
  .totals {
    border-top: 1px dashed #DED4B8;
    padding-top: 10px;
  }
  .total-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
  }
  .total-grand {
    font-weight: 700;
    border-top: 1px solid #DED4B8;
    margin-top: 4px;
    padding-top: 8px;
  }
  .total-remaining {
    font-weight: 700;
    font-size: 15px;
    color: #A9372F;
  }
  .footer {
    text-align: center;
    margin-top: 16px;
    font-size: 11.5px;
    color: #746A58;
  }
  .footer div + div {
    margin-top: 2px;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="shop-ur">${SHOP_NAME_UR}</div>
    <div class="shop-en">${escapeHtml(SHOP_NAME_EN)}</div>
    <div class="title">${TITLE[bill.party_type]}</div>
  </div>
  <div class="meta">
    <div class="meta-row"><span>Bill #</span><span>${bill.id}</span></div>
    <div class="meta-row"><span>Date</span><span>${formatDateTime(bill.bill_date)}</span></div>
    <div class="meta-row"><span>${PARTY_LABEL[bill.party_type]}</span><span>${escapeHtml(bill.party_name)}</span></div>
    ${bill.party_contact ? `<div class="meta-row"><span>Contact</span><span>${escapeHtml(bill.party_contact)}</span></div>` : ''}
  </div>
  <table>
    <thead>
      <tr><th>Date</th><th>Item</th><th class="num">KG</th><th class="num">Rate</th><th class="num">Total</th></tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  ${
    bill.payments.length > 0
      ? `<table class="payments-table">
    <thead>
      <tr><th>Date</th><th>Method</th><th class="num">Paid</th></tr>
    </thead>
    <tbody>${paymentRows}</tbody>
  </table>`
      : ''
  }
  <div class="totals">
    <div class="total-row"><span>This bill's purchases</span><span>${formatRs(bill.subtotal)}</span></div>
    <div class="total-row"><span>Previous due</span><span>${formatRs(bill.previous_due)}</span></div>
    <div class="total-row total-grand"><span>Grand total</span><span>${formatRs(bill.total_due_after_bill)}</span></div>
    <div class="total-row"><span>Total paid</span><span>${paidTotal > 0 ? formatRs(paidTotal) : '\u2014 (not paid yet)'}</span></div>
    <div class="total-row total-remaining"><span>Remaining due</span><span>${formatRs(bill.remaining_due)}</span></div>
  </div>
  <div class="footer">
    <div>Powered by R&amp;R Digital Solutions</div>
    <div>Contact: 03126641281</div>
  </div>
</body>
</html>`;
}

const IMAGE_WIDTH = 430;

async function renderHtmlToImage(html: string): Promise<Electron.NativeImage> {
  const hiddenWindow = new BrowserWindow({
    show: false,
    width: IMAGE_WIDTH,
    height: 600, // temporary - resized to fit content below
    webPreferences: { offscreen: false },
  });
  try {
    await hiddenWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const contentHeight: number = await hiddenWindow.webContents.executeJavaScript('document.body.scrollHeight');
    hiddenWindow.setContentSize(IMAGE_WIDTH, Math.ceil(contentHeight));
    // Let layout settle after the resize before capturing.
    await new Promise((resolve) => setTimeout(resolve, 80));
    return await hiddenWindow.webContents.capturePage();
  } finally {
    hiddenWindow.destroy();
  }
}

/**
 * Turns a Pakistani-style local number ('0312...') into the international
 * format WhatsApp's wa.me links expect ('92312...', no leading zero, no
 * spaces/dashes). Returns null for anything that doesn't look like a
 * plausible phone number, so callers can fall back to opening WhatsApp
 * without a pre-selected chat rather than building a broken link.
 */
function toWhatsAppNumber(contact: string): string | null {
  const digits = contact.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) return `92${digits.slice(1)}`;
  if (digits.startsWith('92') && digits.length === 12) return digits;
  return null;
}

export interface ShareBillImageResult {
  savedPath: string;
  whatsappUrl: string | null;
}

/**
 * Builds the bill image, copies it to the clipboard, saves a copy to disk
 * as a fallback, and returns a wa.me link (if the party has a usable
 * contact number) for the caller to open. There's no API for a fully
 * offline app to hand WhatsApp an image directly and have it auto-attach -
 * copy-then-paste is the smoothest real alternative on both WhatsApp
 * Desktop and Web.
 */
export async function shareBillAsImage(
  db: Database.Database,
  partyType: PartyType,
  billId: number
): Promise<ShareBillImageResult> {
  const bill = getBillById(db, partyType, billId);
  const html = buildBillHtml(bill);
  const image = await renderHtmlToImage(html);

  clipboard.writeImage(image);

  const folder = path.join(app.getPath('documents'), 'Ghousia Chicken Khata Bills');
  fs.mkdirSync(folder, { recursive: true });
  const safeName = bill.party_name.replace(/[^\w\- ]/g, '').trim() || 'bill';
  const savedPath = path.join(folder, `${safeName} - Bill ${bill.id}.png`);
  fs.writeFileSync(savedPath, image.toPNG());

  const whatsappNumber = bill.party_contact ? toWhatsAppNumber(bill.party_contact) : null;
  const whatsappUrl = whatsappNumber ? `https://wa.me/${whatsappNumber}` : null;
  if (whatsappUrl) {
    shell.openExternal(whatsappUrl);
  }

  return { savedPath, whatsappUrl };
}
