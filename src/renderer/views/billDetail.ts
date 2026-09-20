import { el, mount } from '../dom';
import { formatDateShort, formatDateTime, formatRs } from '../format';
import { button, confirmDialog, errorBanner, errorMessage, ipcErrorMessage, loadingState, successBanner } from '../components';
import { navigate } from '../router';
import { SHOP_NAME_EN, SHOP_NAME_UR } from '../shopConfig';
import type { BillDetail, PartyType } from '../../main/types';

const TITLE: Record<PartyType, string> = {
  supplier: 'Supplier Bill',
  customer: 'Customer Bill',
  shopkeeper: 'Shopkeeper Bill',
};
const PARTY_LABEL: Record<PartyType, string> = { supplier: 'Supplier', customer: 'Customer', shopkeeper: 'Shopkeeper' };
const PAYMENT_METHOD_LABEL: Record<string, string> = { cash: 'Cash', online: 'Online' };

function receiptMarkup(bill: BillDetail): HTMLElement {
  const paidTotal = Math.floor(bill.payments.reduce((sum, p) => sum + p.amount, 0));

  const itemRows = bill.items.map((item) =>
    el('tr', {}, [
      el('td', {}, [formatDateShort(item.entry_date)]),
      el('td', {}, [item.item_name]),
      el('td', { class: 'cell-number' }, [String(item.weight_kg)]),
      el('td', { class: 'cell-number' }, [formatRs(item.rate_per_kg)]),
      el('td', { class: 'cell-number' }, [formatRs(item.line_total)]),
    ])
  );

  const paymentRows = bill.payments.map((payment) =>
    el('tr', {}, [
      el('td', {}, [formatDateShort(payment.paid_at)]),
      el('td', {}, [payment.payment_method ? PAYMENT_METHOD_LABEL[payment.payment_method] : '\u2014']),
      el('td', { class: 'cell-number' }, [formatRs(payment.amount)]),
    ])
  );

  return el('div', { class: 'receipt', id: 'receipt-print-area' }, [
    el('div', { class: 'receipt-header' }, [
      el('div', { class: 'receipt-shop-ur', dir: 'rtl', lang: 'ur' }, [SHOP_NAME_UR]),
      el('div', { class: 'receipt-shop-en' }, [SHOP_NAME_EN]),
      el('div', { class: 'receipt-title' }, [TITLE[bill.party_type]]),
    ]),
    el('div', { class: 'receipt-meta' }, [
      el('div', {}, [el('span', {}, ['Bill #']), el('span', {}, [String(bill.id)])]),
      el('div', {}, [el('span', {}, ['Date']), el('span', {}, [formatDateTime(bill.bill_date)])]),
      el('div', {}, [el('span', {}, [PARTY_LABEL[bill.party_type]]), el('span', {}, [bill.party_name])]),
      bill.party_contact
        ? el('div', {}, [el('span', {}, ['Contact']), el('span', {}, [bill.party_contact])])
        : null,
    ]),
    el('table', { class: 'receipt-items' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Date']),
          el('th', {}, ['Item']),
          el('th', { class: 'th-right' }, ['KG']),
          el('th', { class: 'th-right' }, ['Rate']),
          el('th', { class: 'th-right' }, ['Total']),
        ]),
      ]),
      el('tbody', {}, itemRows),
    ]),
    el('div', { class: 'receipt-totals' }, [
      el('div', { class: 'receipt-total-row' }, [el('span', {}, ['This bill\u2019s purchases']), el('span', {}, [formatRs(bill.subtotal)])]),
      el('div', { class: 'receipt-total-row' }, [el('span', {}, ['Previous due']), el('span', {}, [formatRs(bill.previous_due)])]),
      el('div', { class: 'receipt-total-row receipt-total-grand' }, [
        el('span', {}, ['Grand total']),
        el('span', {}, [formatRs(bill.total_due_after_bill)]),
      ]),
      paidTotal > 0
        ? el('div', { class: 'receipt-total-row' }, [el('span', {}, ['Total paid']), el('span', {}, [formatRs(paidTotal)])])
        : el('div', { class: 'receipt-total-row' }, [el('span', {}, ['Total paid']), el('span', {}, ['\u2014 (not paid yet)'])]),
      el('div', { class: 'receipt-total-row receipt-total-remaining' }, [
        el('span', {}, ['Remaining due']),
        el('span', {}, [formatRs(bill.remaining_due)]),
      ]),
    ]),
    bill.payments.length > 0
      ? el('div', { class: 'receipt-section' }, [
          el('div', { class: 'receipt-section-label' }, ['Payments']),
          el('table', { class: 'receipt-items receipt-payments' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', {}, ['Date']),
                el('th', {}, ['Method']),
                el('th', { class: 'th-right' }, ['Paid']),
              ]),
            ]),
            el('tbody', {}, paymentRows),
          ]),
        ])
      : null,
    el('div', { class: 'receipt-footer' }, [
      el('div', {}, ['Powered by R&R Digital Solutions']),
      el('div', {}, ['Contact: 03126641281']),
      el('div', {}, ['www.hasnainzainulabdin.vercel.app']),
    ]),
  ]);
}

// "3 entries and 2 payments" / "1 entry" / "2 payments" - leaves out whichever
// part is zero, since a bill can hold only entries or only payments.
function describeContents(entries: number, payments: number): string {
  const parts: string[] = [];
  if (entries > 0) parts.push(`${entries} ${entries === 1 ? 'entry' : 'entries'}`);
  if (payments > 0) parts.push(`${payments} ${payments === 1 ? 'payment' : 'payments'}`);
  return parts.length > 0 ? parts.join(' and ') : '0 entries';
}

export async function renderBillDetail(
  partyType: PartyType,
  billId: number,
  container: HTMLElement
): Promise<void> {
  mount(container, loadingState('Loading bill...'));

  let bill: BillDetail;
  try {
    bill = await window.khata.getBill({ partyType, billId });
  } catch (err) {
    mount(container, errorBanner(errorMessage(err)));
    return;
  }

  const backHref = `#/${partyType}s/${bill.party_id}`;
  const backLink = el('a', { href: backHref, class: 'back-link' }, [`\u2190 Back to ${bill.party_name}`]);

  const printBtn = button('Print bill', () => window.print());

  const shareStatus = el('div', { class: 'form-error-slot no-print' });
  const shareBtn = button('Share to WhatsApp', async () => {
    shareStatus.replaceChildren();
    shareBtn.disabled = true;
    const originalLabel = shareBtn.textContent;
    shareBtn.textContent = 'Preparing image\u2026';
    try {
      const result = await window.khata.shareBillImage({ partyType, billId: bill.id });
      shareStatus.replaceChildren(
        successBanner(
          result.whatsappUrl
            ? `Bill image copied and WhatsApp opened for ${bill.party_name}. Press Ctrl+V in the chat, then Send.`
            : `Bill image copied to clipboard. Open WhatsApp, pick ${bill.party_name}\u2019s chat (no phone number on file to auto-open it), and press Ctrl+V, then Send.`
        )
      );
    } catch (err) {
      shareStatus.replaceChildren(errorBanner(errorMessage(err)));
    } finally {
      shareBtn.disabled = false;
      shareBtn.textContent = originalLabel;
    }
  }, 'secondary');

  const restoreBtn = button('Restore bill', async () => {
    shareStatus.replaceChildren();

    const confirmed = await confirmDialog(
      `Restore Bill #${bill.id} for ${bill.party_name}?\n\n` +
        `Its ${describeContents(bill.items.length, bill.payments.length)} will go back to unbilled, ` +
        `with their original dates and amounts, and this bill will be deleted.\n\n` +
        `You can then edit or delete entries and generate a new bill. Any copy of this bill that was ` +
        `already printed or sent on WhatsApp will no longer match your records.`,
      { confirmLabel: 'Restore & Delete Bill', danger: true }
    );
    if (!confirmed) return;

    restoreBtn.disabled = true;
    try {
      const result = await window.khata.restoreBill({ partyType, billId: bill.id });
      // The bill no longer exists, so this page can't be shown again - swap
      // it for a confirmation and a way straight to the entries.
      mount(
        container,
        el('div', { class: 'page-header' }, [el('h1', {}, ['Bill restored'])]),
        successBanner(
          `Bill #${bill.id} was deleted. Its ${describeContents(result.entriesRestored, result.paymentsRestored)} ` +
            `${result.entriesRestored + result.paymentsRestored === 1 ? 'is' : 'are'} back in the unbilled list for ${result.partyName}, ` +
            `with their original dates and amounts.`
        ),
        el('div', { class: 'form-actions' }, [
          button(`Go to ${result.partyName}`, () => navigate(`/${partyType}s/${result.partyId}`)),
        ])
      );
    } catch (err) {
      shareStatus.replaceChildren(errorBanner(ipcErrorMessage(err)));
      restoreBtn.disabled = false;
    }
  }, 'danger');

  mount(
    container,
    el('div', { class: 'no-print' }, [backLink]),
    el('div', { class: 'page-header no-print' }, [
      el('h1', {}, [TITLE[bill.party_type]]),
      el('div', { class: 'page-header-actions' }, [printBtn, shareBtn, restoreBtn]),
    ]),
    shareStatus,
    receiptMarkup(bill)
  );
}
