import { el, mount } from '../dom';
import { formatDate, formatDateShort, formatDateTime, formatRs, todayIso } from '../format';
import {
  button,
  confirmDialog,
  emptyState,
  errorBanner,
  errorMessage,
  itemSelect,
  loadingState,
  pageHeader,
} from '../components';
import { navigate } from '../router';
import { SHOP_NAME_EN, SHOP_NAME_UR } from '../shopConfig';
import type { CounterSaleBill, CounterSaleEntry } from '../../main/types';

// Counter Sale = walk-in sales: no customer profile, no due, no payments.
// Everything on this page lives in its own tables - it is deliberately NOT
// part of the Daily Ledger, profit/loss, the Bills list or any balance.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Floors to a whole rupee (same rule as everywhere in the app; main's
// floorMoney can't be imported here - see partyProfile.ts).
function floorMoney(n: number): number {
  return Math.floor(n);
}

function dateBar(selectedDate: string): HTMLElement {
  const dateInput = el('input', { type: 'date', value: selectedDate }) as HTMLInputElement;
  dateInput.addEventListener('change', () => {
    if (DATE_RE.test(dateInput.value)) navigate(`/counter-sale/${dateInput.value}`);
  });
  const todayBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, ['Today']);
  todayBtn.addEventListener('click', () => navigate(`/counter-sale/${todayIso()}`));

  return el('div', { class: 'ledger-date-bar' }, [
    el('label', { class: 'ledger-date-label' }, ['Select date', dateInput]),
    todayBtn,
  ]);
}

function addItemForm(defaultDate: string, onSaved: () => void): HTMLElement {
  const nameInput = el('input', { type: 'text', maxlength: '80', placeholder: 'Optional' }) as HTMLInputElement;
  const numberInput = el('input', { type: 'text', maxlength: '30', placeholder: 'Optional' }) as HTMLInputElement;
  const itemInput = itemSelect();
  const dateInput = el('input', { type: 'date', value: defaultDate }) as HTMLInputElement;
  const kgInput = el('input', { type: 'number', step: '0.01', min: '0', placeholder: '0' }) as HTMLInputElement;
  const rateInput = el('input', { type: 'number', step: '0.01', min: '0', placeholder: '0' }) as HTMLInputElement;
  const totalPreview = el('span', { class: 'total-preview' }, [formatRs(0)]);
  const errorSlot = el('div', { class: 'form-error-slot' });

  function updatePreview() {
    const kg = Number(kgInput.value);
    const rate = Number(rateInput.value);
    totalPreview.textContent = formatRs(Number.isFinite(kg) && Number.isFinite(rate) ? floorMoney(kg * rate) : 0);
  }
  kgInput.addEventListener('input', updatePreview);
  rateInput.addEventListener('input', updatePreview);

  const form = el('form', { class: 'inline-form' }, [
    el('div', { class: 'form-grid form-grid-tight' }, [
      el('label', {}, ['Customer name (optional)', nameInput]),
      el('label', {}, ['Number (optional)', numberInput]),
      el('label', {}, ['Item', itemInput]),
      el('label', {}, ['Date', dateInput]),
      el('label', {}, ['KG', kgInput]),
      el('label', {}, ['Rate per KG (Rs.)', rateInput]),
    ]),
    el('div', { class: 'total-preview-row' }, ['Total: ', totalPreview]),
    errorSlot,
    el('div', { class: 'form-actions' }, [el('button', { class: 'btn btn-primary', type: 'submit' }, ['Submit'])]),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorSlot.replaceChildren();

    const weightKg = Number(kgInput.value);
    const ratePerKg = Number(rateInput.value);
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      errorSlot.append(errorBanner('KG must be greater than zero.'));
      return;
    }
    if (!Number.isFinite(ratePerKg) || ratePerKg <= 0) {
      errorSlot.append(errorBanner('Rate per KG must be greater than zero.'));
      return;
    }
    if (!DATE_RE.test(dateInput.value)) {
      errorSlot.append(errorBanner('Date is required.'));
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = true;
    try {
      await window.khata.addCounterSaleEntry({
        customerName: nameInput.value,
        customerNumber: numberInput.value,
        itemName: itemInput.value,
        weightKg,
        ratePerKg,
        entryDate: dateInput.value,
      });
      // The customer's name/number stay filled in so the next item for the
      // same customer is just item + KG + rate; only the amounts reset.
      kgInput.value = '';
      rateInput.value = '';
      updatePreview();
      onSaved();
    } catch (err) {
      errorSlot.replaceChildren(errorBanner(errorMessage(err)));
    } finally {
      submitBtn.disabled = false;
    }
  });

  return form;
}

function pendingTable(entries: CounterSaleEntry[], onChanged: () => void): HTMLElement {
  if (entries.length === 0) {
    return emptyState('No items added yet. Add the first item above.');
  }

  const rows = entries.map((entry) => {
    const rowErrorSlot = el('div', { class: 'form-error-slot' });
    const deleteBtn = el('button', { class: 'btn btn-danger btn-small', type: 'button' }, ['Remove']) as HTMLButtonElement;
    deleteBtn.addEventListener('click', async () => {
      const ok = await confirmDialog(`Remove ${entry.item_name} (${formatRs(entry.line_total)}) from this bill?`, {
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      deleteBtn.disabled = true;
      try {
        await window.khata.deleteCounterSaleEntry({ entryId: entry.id });
        onChanged();
      } catch (err) {
        rowErrorSlot.replaceChildren(errorBanner(errorMessage(err)));
        deleteBtn.disabled = false;
      }
    });
    return el('tr', {}, [
      el('td', {}, [entry.customer_name || '\u2014']),
      el('td', { class: 'cell-muted' }, [formatDate(entry.entry_date)]),
      el('td', {}, [entry.item_name]),
      el('td', { class: 'cell-number' }, [String(entry.weight_kg)]),
      el('td', { class: 'cell-number' }, [formatRs(entry.rate_per_kg)]),
      el('td', { class: 'cell-number cell-strong' }, [formatRs(entry.line_total)]),
      el('td', { class: 'cell-actions' }, [deleteBtn, rowErrorSlot]),
    ]);
  });

  const total = floorMoney(entries.reduce((sum, e) => sum + e.line_total, 0));
  return el('table', { class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Customer']),
        el('th', {}, ['Date']),
        el('th', {}, ['Item']),
        el('th', { class: 'th-right' }, ['KG']),
        el('th', { class: 'th-right' }, ['Rate']),
        el('th', { class: 'th-right' }, ['Total']),
        el('th', {}, ['']),
      ]),
    ]),
    el('tbody', {}, rows),
    el('tfoot', {}, [
      el('tr', {}, [
        el('td', { colspan: '5' }, ['Bill total']),
        el('td', { class: 'cell-number cell-strong' }, [formatRs(total)]),
        el('td', {}, []),
      ]),
    ]),
  ]);
}

function currentBillPanel(entries: CounterSaleEntry[], onChanged: () => void): HTMLElement {
  const errorSlot = el('div', { class: 'form-error-slot' });
  const wrap = el('div', {});
  wrap.append(pendingTable(entries, onChanged));
  wrap.append(errorSlot);

  if (entries.length > 0) {
    const generateBtn = button('Generate Bill', async () => {
      errorSlot.replaceChildren();
      generateBtn.disabled = true;
      try {
        const bill = await window.khata.generateCounterSaleBill({ entryIds: entries.map((e) => e.id) });
        navigate(`/counter-sale/bill/${bill.id}`);
      } catch (err) {
        errorSlot.replaceChildren(errorBanner(errorMessage(err)));
        generateBtn.disabled = false;
      }
    });
    wrap.append(el('div', { class: 'form-actions' }, [generateBtn]));
  }
  return wrap;
}

// The day's finished bills, at the very end of the page. Each shows who it
// was for (the typed name, or Customer 1, 2, ... for unnamed ones), and every
// item's KG, rate and total, plus the bill total.
function billsForDate(bills: CounterSaleBill[], date: string): HTMLElement {
  if (bills.length === 0) {
    return emptyState(`No counter sale bills for ${formatDate(date)}.`);
  }

  const dayTotal = floorMoney(bills.reduce((sum, b) => sum + b.total, 0));

  const cards = bills.map((bill) => {
    const viewBtn = button('View / Print', () => navigate(`/counter-sale/bill/${bill.id}`), 'secondary');
    return el('div', { class: 'counter-bill-card' }, [
      el('div', { class: 'counter-bill-head' }, [
        el('div', {}, [
          el('div', { class: 'counter-bill-name' }, [bill.customer_label]),
          el('div', { class: 'cell-muted' }, [
            `Bill #${bill.id} \u00b7 ${formatDateTime(bill.bill_date)}${bill.customer_number ? ` \u00b7 ${bill.customer_number}` : ''}`,
          ]),
        ]),
        viewBtn,
      ]),
      el('table', { class: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', {}, ['Item']),
            el('th', { class: 'th-right' }, ['KG']),
            el('th', { class: 'th-right' }, ['Rate']),
            el('th', { class: 'th-right' }, ['Total']),
          ]),
        ]),
        el(
          'tbody',
          {},
          bill.items.map((item) =>
            el('tr', {}, [
              el('td', {}, [item.item_name]),
              el('td', { class: 'cell-number' }, [String(item.weight_kg)]),
              el('td', { class: 'cell-number' }, [formatRs(item.rate_per_kg)]),
              el('td', { class: 'cell-number' }, [formatRs(item.line_total)]),
            ])
          )
        ),
        el('tfoot', {}, [
          el('tr', {}, [
            el('td', { colspan: '3' }, ['Bill total']),
            el('td', { class: 'cell-number cell-strong' }, [formatRs(bill.total)]),
          ]),
        ]),
      ]),
    ]);
  });

  return el('div', {}, [
    ...cards,
    el('div', { class: 'total-preview-row' }, [
      `Total counter sales on ${formatDate(date)}: `,
      el('span', { class: 'total-preview' }, [formatRs(dayTotal)]),
    ]),
  ]);
}

export async function renderCounterSale(date: string, container: HTMLElement): Promise<void> {
  if (!DATE_RE.test(date)) {
    mount(container, pageHeader('Counter Sale'), errorBanner('That date doesn\u2019t look right.'));
    return;
  }
  mount(container, loadingState('Loading counter sale...'));

  const pendingWrap = el('div', {});
  const billsWrap = el('div', {});
  const formWrap = el('div', {});

  async function load(): Promise<void> {
    try {
      const [pending, bills] = await Promise.all([
        window.khata.listPendingCounterSaleEntries(),
        window.khata.listCounterSaleBills({ date }),
      ]);
      mount(pendingWrap, currentBillPanel(pending, load));
      mount(billsWrap, billsForDate(bills, date));
    } catch (err) {
      mount(pendingWrap, errorBanner(errorMessage(err)));
    }
  }

  formWrap.append(addItemForm(date, load));

  mount(
    container,
    pageHeader('Counter Sale'),
    dateBar(date),
    el('p', { class: 'field-hint' }, [
      'Walk-in sales. These are kept separate \u2014 they are not part of the Daily Ledger, profit / loss or any customer account.',
    ]),
    el('section', { class: 'panel' }, [el('h2', {}, ['Add Item']), formWrap]),
    el('section', { class: 'panel' }, [el('h2', {}, ['Current Bill']), pendingWrap]),
    // Finished bills always sit at the end of the page, for the date picked above.
    el('section', { class: 'panel' }, [el('h2', {}, [`Counter Sale Bills \u2014 ${formatDate(date)}`]), billsWrap])
  );

  await load();
}

// The printable counter-sale bill: same look as a customer bill, minus the
// previous due / payments (a walk-in sale has neither).
export async function renderCounterSaleBill(billId: number, container: HTMLElement): Promise<void> {
  mount(container, loadingState('Loading bill...'));

  let bill: CounterSaleBill;
  try {
    bill = await window.khata.getCounterSaleBill({ billId });
  } catch (err) {
    mount(container, errorBanner(errorMessage(err)));
    return;
  }

  const billDay = bill.bill_date.slice(0, 10);
  const backLink = el('a', { href: `#/counter-sale/${billDay}`, class: 'back-link' }, [
    `\u2190 Back to counter sales (${formatDate(billDay)})`,
  ]);
  const printBtn = button('Print bill', () => window.print());

  const itemRows = bill.items.map((item) =>
    el('tr', {}, [
      el('td', {}, [formatDateShort(item.entry_date)]),
      el('td', {}, [item.item_name]),
      el('td', { class: 'cell-number' }, [String(item.weight_kg)]),
      el('td', { class: 'cell-number' }, [formatRs(item.rate_per_kg)]),
      el('td', { class: 'cell-number' }, [formatRs(item.line_total)]),
    ])
  );

  const receipt = el('div', { class: 'receipt', id: 'receipt-print-area' }, [
    el('div', { class: 'receipt-header' }, [
      el('div', { class: 'receipt-shop-ur', dir: 'rtl', lang: 'ur' }, [SHOP_NAME_UR]),
      el('div', { class: 'receipt-shop-en' }, [SHOP_NAME_EN]),
      el('div', { class: 'receipt-title' }, ['Customer Bill']),
    ]),
    el('div', { class: 'receipt-meta' }, [
      el('div', {}, [el('span', {}, ['Bill #']), el('span', {}, [String(bill.id)])]),
      el('div', {}, [el('span', {}, ['Date']), el('span', {}, [formatDateTime(bill.bill_date)])]),
      el('div', {}, [el('span', {}, ['Customer']), el('span', {}, [bill.customer_label])]),
      bill.customer_number
        ? el('div', {}, [el('span', {}, ['Contact']), el('span', {}, [bill.customer_number])])
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
      el('div', { class: 'receipt-total-row receipt-total-grand' }, [
        el('span', {}, ['Total']),
        el('span', {}, [formatRs(bill.total)]),
      ]),
    ]),
    el('div', { class: 'receipt-footer' }, [
      el('div', {}, ['Powered by R&R Digital Solutions']),
      el('div', {}, ['Contact: 03126641281']),
      el('div', {}, ['www.hasnainzainulabdin.vercel.app']),
    ]),
  ]);

  mount(
    container,
    el('div', { class: 'no-print' }, [backLink]),
    el('div', { class: 'page-header no-print' }, [
      el('h1', {}, ['Counter Sale Bill']),
      el('div', { class: 'page-header-actions' }, [printBtn]),
    ]),
    receipt
  );
}
