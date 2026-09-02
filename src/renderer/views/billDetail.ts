import { el, mount } from '../dom';
import { formatDate, formatDateTime, formatRs } from '../format';
import { button, errorBanner, errorMessage, loadingState, successBanner } from '../components';
import { SHOP_NAME_EN, SHOP_NAME_UR } from '../shopConfig';
import type { BillDetail, PartyType } from '../../main/types';

const TITLE: Record<PartyType, string> = {
  supplier: 'Supplier Bill',
  customer: 'Customer Bill',
  shopkeeper: 'Shopkeeper Bill',
};
const PARTY_LABEL: Record<PartyType, string> = { supplier: 'Supplier', customer: 'Customer', shopkeeper: 'Shopkeeper' };

function receiptMarkup(bill: BillDetail): HTMLElement {
  const paymentNow = Math.floor(bill.total_due_after_bill - bill.remaining_due);

  const itemRows = bill.items.map((item) =>
    el('tr', {}, [
      el('td', {}, [formatDate(item.entry_date)]),
      el('td', {}, [item.item_name]),
      el('td', { class: 'cell-number' }, [String(item.weight_kg)]),
      el('td', { class: 'cell-number' }, [formatRs(item.rate_per_kg)]),
      el('td', { class: 'cell-number' }, [formatRs(item.line_total)]),
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
      paymentNow > 0
        ? el('div', { class: 'receipt-total-row' }, [el('span', {}, ['Paid now']), el('span', {}, [formatRs(paymentNow)])])
        : el('div', { class: 'receipt-total-row' }, [el('span', {}, ['Paid now']), el('span', {}, ['\u2014 (not paid yet)'])]),
      el('div', { class: 'receipt-total-row receipt-total-remaining' }, [
        el('span', {}, ['Remaining due']),
        el('span', {}, [formatRs(bill.remaining_due)]),
      ]),
    ]),
    el('div', { class: 'receipt-footer' }, [
      el('div', {}, ['Powered by R&R Digital Solutions']),
      el('div', {}, ['Contact: 03126641281']),
    ]),
  ]);
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

  mount(
    container,
    el('div', { class: 'no-print' }, [backLink]),
    el('div', { class: 'page-header no-print' }, [
      el('h1', {}, [TITLE[bill.party_type]]),
      el('div', { class: 'page-header-actions' }, [printBtn, shareBtn]),
    ]),
    shareStatus,
    receiptMarkup(bill)
  );
}
