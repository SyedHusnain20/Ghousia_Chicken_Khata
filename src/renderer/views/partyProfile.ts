import { el, mount } from '../dom';
import { formatDue, formatRs, formatDateTime, todayIso } from '../format';
import { emptyState, errorBanner, errorMessage, loadingState } from '../components';
import { navigate } from '../router';
import type { BillListItem, Entry, Party, PartyType, Payment } from '../../main/types';

// Floors to a whole rupee, without pulling in main's floorMoney (that
// helper lives in a file that imports better-sqlite3 - fine for main, but
// that import must never end up in the renderer bundle). Every money
// amount in this app is a whole number of rupees - see partyService.ts's
// floorMoney for the full rationale.
function floorMoney(n: number): number {
  return Math.floor(n);
}

const COPY: Record<
  PartyType,
  { title: string; entryVerb: string; entryNoun: string; listPath: string; addEntryLabel: string }
> = {
  supplier: {
    title: 'Supplier',
    entryVerb: 'Add Purchase',
    entryNoun: 'purchase',
    listPath: '/suppliers',
    addEntryLabel: 'Purchases (unbilled)',
  },
  customer: {
    title: 'Customer',
    entryVerb: 'Add Sale',
    entryNoun: 'sale',
    listPath: '/customers',
    addEntryLabel: 'Sales (unbilled)',
  },
};

function backLink(partyType: PartyType): HTMLElement {
  const copy = COPY[partyType];
  const link = el('a', { href: `#${copy.listPath}`, class: 'back-link' }, [`\u2190 All ${copy.title.toLowerCase()}s`]);
  return link;
}

function deletePartyControls(party: Party, partyType: PartyType): HTMLElement {
  const copy = COPY[partyType];
  const errorSlot = el('div', { class: 'form-error-slot' });
  const deleteBtn = el('button', { class: 'btn btn-danger btn-small', type: 'button' }, [
    `Delete ${copy.title}`,
  ]) as HTMLButtonElement;

  deleteBtn.addEventListener('click', async () => {
    errorSlot.replaceChildren();
    const confirmed = window.confirm(
      `Delete ${party.name}? This can\u2019t be undone. This only works if they have no outstanding balance and no transaction history yet.`
    );
    if (!confirmed) return;

    deleteBtn.disabled = true;
    try {
      await window.khata.deleteParty({ partyType, partyId: party.id });
      navigate(copy.listPath);
    } catch (err) {
      errorSlot.replaceChildren(errorBanner(errorMessage(err)));
      deleteBtn.disabled = false;
    }
  });

  return el('div', { class: 'profile-header-actions' }, [deleteBtn, errorSlot]);
}

function dueHero(party: Party, partyType: PartyType): HTMLElement {
  const due = formatDue(party.current_due);
  const label = partyType === 'supplier' ? 'You owe' : 'Owes you';
  return el('div', { class: `due-hero due-hero-${due.kind}` }, [
    el('div', { class: 'due-hero-info' }, [
      el('h1', {}, [party.name]),
      el('div', { class: 'due-hero-contact' }, [party.contact_number || 'No contact number on file']),
    ]),
    el('div', { class: 'due-hero-amount' }, [
      el('span', { class: 'due-hero-label' }, [due.kind === 'clear' ? 'Settled up' : label]),
      el('span', { class: 'due-hero-value' }, [due.text]),
    ]),
  ]);
}

function addEntryForm(partyType: PartyType, partyId: number, onSaved: () => void): HTMLElement {
  const copy = COPY[partyType];
  const itemInput = el('input', { type: 'text', value: 'Chicken', maxlength: '60' }) as HTMLInputElement;
  const kgInput = el('input', { type: 'number', step: '0.01', min: '0', placeholder: '0' }) as HTMLInputElement;
  const rateInput = el('input', { type: 'number', step: '0.01', min: '0', placeholder: '0' }) as HTMLInputElement;
  const dateInput = el('input', { type: 'date', value: todayIso() }) as HTMLInputElement;
  const totalPreview = el('span', { class: 'total-preview' }, [formatRs(0)]);
  const errorSlot = el('div', { class: 'form-error-slot' });

  function updatePreview() {
    const kg = Number(kgInput.value);
    const rate = Number(rateInput.value);
    const total = Number.isFinite(kg) && Number.isFinite(rate) ? floorMoney(kg * rate) : 0;
    totalPreview.textContent = formatRs(total);
  }
  kgInput.addEventListener('input', updatePreview);
  rateInput.addEventListener('input', updatePreview);

  const form = el('form', { class: 'inline-form' }, [
    el('div', { class: 'form-grid form-grid-tight' }, [
      el('label', {}, ['Item', itemInput]),
      el('label', {}, ['Weight (KG)', kgInput]),
      el('label', {}, ['Rate per KG (Rs.)', rateInput]),
      el('label', {}, ['Date', dateInput]),
    ]),
    el('div', { class: 'total-preview-row' }, ['Total: ', totalPreview]),
    errorSlot,
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'submit' }, [copy.entryVerb]),
    ]),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorSlot.replaceChildren();

    const weightKg = Number(kgInput.value);
    const ratePerKg = Number(rateInput.value);
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      errorSlot.append(errorBanner('Weight (KG) must be greater than zero.'));
      return;
    }
    if (!Number.isFinite(ratePerKg) || ratePerKg <= 0) {
      errorSlot.append(errorBanner('Rate per KG must be greater than zero.'));
      return;
    }
    if (!dateInput.value) {
      errorSlot.append(errorBanner('Date is required.'));
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = true;
    try {
      await window.khata.addEntry({
        partyType,
        partyId,
        itemName: itemInput.value.trim() || 'Chicken',
        weightKg,
        ratePerKg,
        entryDate: dateInput.value,
      });
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

function paymentForm(partyType: PartyType, partyId: number, currentDue: number, onSaved: () => void): HTMLElement {
  const amountInput = el('input', { type: 'number', step: '0.01', min: '0.01', placeholder: '0' }) as HTMLInputElement;
  const errorSlot = el('div', { class: 'form-error-slot' });

  const hint = el('p', { class: 'field-hint' }, [
    currentDue > 0
      ? `Current due is ${formatRs(currentDue)}. Entering an amount reduces it right away.`
      : 'There is no outstanding due right now. A payment here will create a credit balance.',
  ]);

  const form = el('form', { class: 'inline-form' }, [
    el('div', { class: 'form-grid form-grid-tight' }, [el('label', {}, ['Amount (Rs.)', amountInput])]),
    hint,
    errorSlot,
    el('div', { class: 'form-actions' }, [el('button', { class: 'btn btn-primary', type: 'submit' }, ['Record Payment'])]),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorSlot.replaceChildren();

    const amount = Number(amountInput.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      errorSlot.append(errorBanner('Payment amount must be a positive number.'));
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = true;
    try {
      await window.khata.recordPayment({ partyType, partyId, amount, note: 'Standalone payment' });
      amountInput.value = '';
      onSaved();
    } catch (err) {
      errorSlot.replaceChildren(errorBanner(errorMessage(err)));
    } finally {
      submitBtn.disabled = false;
    }
  });

  return form;
}

function entryEditRow(
  entry: Entry,
  partyType: PartyType,
  partyId: number,
  onDone: (changed: boolean) => void
): HTMLElement {
  const itemInput = el('input', { type: 'text', value: entry.item_name, maxlength: '60' }) as HTMLInputElement;
  const kgInput = el('input', {
    type: 'number',
    step: '0.01',
    min: '0',
    value: String(entry.weight_kg),
  }) as HTMLInputElement;
  const rateInput = el('input', {
    type: 'number',
    step: '0.01',
    min: '0',
    value: String(entry.rate_per_kg),
  }) as HTMLInputElement;
  const dateInput = el('input', {
    type: 'date',
    value: entry.entry_date.split(' ')[0],
  }) as HTMLInputElement;

  const errorSlot = el('div', { class: 'form-error-slot' });

  const saveBtn = el('button', { class: 'btn btn-primary btn-small', type: 'button' }, ['Save']);
  const cancelBtn = el('button', { class: 'btn btn-secondary btn-small', type: 'button' }, ['Cancel']);

  cancelBtn.addEventListener('click', () => onDone(false));

  saveBtn.addEventListener('click', async () => {
    errorSlot.replaceChildren();

    const weightKg = Number(kgInput.value);
    const ratePerKg = Number(rateInput.value);
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      errorSlot.append(errorBanner('Weight (KG) must be greater than zero.'));
      return;
    }
    if (!Number.isFinite(ratePerKg) || ratePerKg <= 0) {
      errorSlot.append(errorBanner('Rate per KG must be greater than zero.'));
      return;
    }
    if (!dateInput.value) {
      errorSlot.append(errorBanner('Date is required.'));
      return;
    }

    (saveBtn as HTMLButtonElement).disabled = true;
    try {
      await window.khata.updateEntry({
        partyType,
        partyId,
        entryId: entry.id,
        itemName: itemInput.value.trim() || 'Chicken',
        weightKg,
        ratePerKg,
        entryDate: dateInput.value,
      });
      onDone(true);
    } catch (err) {
      errorSlot.replaceChildren(errorBanner(errorMessage(err)));
      (saveBtn as HTMLButtonElement).disabled = false;
    }
  });

  return el('tr', { class: 'entry-edit-row' }, [
    el('td', {}, [dateInput]),
    el('td', {}, [itemInput]),
    el('td', {}, [kgInput]),
    el('td', {}, [rateInput]),
    el('td', {}, []),
    el('td', { class: 'cell-actions' }, [
      el('div', { class: 'entry-edit-actions' }, [saveBtn, cancelBtn]),
      errorSlot,
    ]),
  ]);
}

function renderEntriesTable(
  wrap: HTMLElement,
  entries: Entry[],
  partyType: PartyType,
  partyId: number,
  onChanged: () => void
): void {
  if (entries.length === 0) {
    mount(wrap, emptyState('No unbilled entries yet.'));
    return;
  }

  let editingId: number | null = null;

  function render() {
    const rows: HTMLElement[] = [];
    for (const entry of entries) {
      if (entry.id === editingId) {
        rows.push(
          entryEditRow(entry, partyType, partyId, (changed) => {
            editingId = null;
            if (changed) {
              onChanged();
            } else {
              render();
            }
          })
        );
      } else {
        const editBtn = el('button', { class: 'btn btn-secondary btn-small', type: 'button' }, ['Edit']);
        editBtn.addEventListener('click', () => {
          editingId = entry.id;
          render();
        });

        const deleteBtn = el('button', { class: 'btn btn-danger btn-small', type: 'button' }, ['Delete']);
        const rowErrorSlot = el('div', { class: 'form-error-slot' });
        deleteBtn.addEventListener('click', async () => {
          const confirmed = window.confirm(
            `Delete this ${entry.item_name} entry (${formatRs(entry.line_total)})? This can\u2019t be undone.`
          );
          if (!confirmed) return;
          (deleteBtn as HTMLButtonElement).disabled = true;
          rowErrorSlot.replaceChildren();
          try {
            await window.khata.deleteEntry({ partyType, partyId, entryId: entry.id });
            onChanged();
          } catch (err) {
            rowErrorSlot.replaceChildren(errorBanner(errorMessage(err)));
            (deleteBtn as HTMLButtonElement).disabled = false;
          }
        });

        rows.push(
          el('tr', {}, [
            el('td', {}, [formatDateTime(entry.entry_date)]),
            el('td', {}, [entry.item_name]),
            el('td', { class: 'cell-number' }, [String(entry.weight_kg)]),
            el('td', { class: 'cell-number' }, [formatRs(entry.rate_per_kg)]),
            el('td', { class: 'cell-number cell-strong' }, [formatRs(entry.line_total)]),
            el('td', { class: 'cell-actions' }, [
              el('div', { class: 'entry-edit-actions' }, [editBtn, deleteBtn]),
              rowErrorSlot,
            ]),
          ])
        );
      }
    }

    const total = entries.reduce((sum, e) => sum + e.line_total, 0);
    mount(
      wrap,
      el('table', { class: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, [
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
            el('td', { colspan: '5' }, ['Unbilled subtotal']),
            el('td', { class: 'cell-number cell-strong' }, [formatRs(total)]),
          ]),
        ]),
      ])
    );
  }

  render();
}

function paymentsTable(payments: Payment[]): HTMLElement {
  if (payments.length === 0) {
    return emptyState('No payments recorded yet.');
  }
  const rows = payments.map((p) =>
    el('tr', {}, [
      el('td', {}, [formatDateTime(p.paid_at)]),
      el('td', { class: 'cell-number cell-strong' }, [formatRs(p.amount)]),
      el('td', { class: 'cell-muted' }, [p.bill_id ? `Bill #${p.bill_id}` : p.note || 'Standalone']),
    ])
  );
  return el('table', { class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Date']),
        el('th', { class: 'th-right' }, ['Amount']),
        el('th', {}, ['Source']),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

function billsTable(bills: BillListItem[], partyType: PartyType): HTMLElement {
  if (bills.length === 0) {
    return emptyState('No bills generated yet.');
  }
  const rows = bills.map((bill) => {
    const row = el('tr', { class: 'clickable-row', tabindex: '0' }, [
      el('td', {}, [formatDateTime(bill.bill_date)]),
      el('td', {}, [`#${bill.id}`]),
      el('td', { class: 'cell-number' }, [formatRs(bill.subtotal)]),
      el('td', { class: 'cell-number cell-strong' }, [formatRs(bill.remaining_due)]),
    ]);
    const go = () => navigate(`/bills/${partyType}/${bill.id}`);
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') go();
    });
    return row;
  });
  return el('table', { class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Date']),
        el('th', {}, ['Bill']),
        el('th', { class: 'th-right' }, ['Subtotal']),
        el('th', { class: 'th-right' }, ['Remaining due']),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

// The Generate Bill panel: shows a preview of what the bill will contain
// (built entirely from data already on the page - no extra fetch needed),
// an optional payment-now field, and generates + navigates straight to the
// printable bill on success.
function generateBillPanel(
  partyType: PartyType,
  partyId: number,
  entries: Entry[],
  currentDue: number
): HTMLElement {
  if (entries.length === 0) {
    return el('p', { class: 'field-hint' }, [
      'There are no unbilled entries yet, so there\u2019s nothing to put on a bill.',
    ]);
  }

  const subtotal = entries.reduce((sum, e) => sum + e.line_total, 0);
  // currentDue already includes these unbilled entries (due updates as
  // soon as each is logged now, not just at bill time), so the grand
  // total the bill will show is simply the current due - not
  // currentDue + subtotal, which would double-count them.
  const grandTotal = currentDue;
  const previousDue = floorMoney(currentDue - subtotal);

  const paymentInput = el('input', { type: 'number', step: '0.01', min: '0', placeholder: '0 (optional)' }) as HTMLInputElement;
  const errorSlot = el('div', { class: 'form-error-slot' });

  const form = el('form', { class: 'inline-form' }, [
    el('div', { class: 'bill-preview' }, [
      el('div', { class: 'bill-preview-row' }, [
        el('span', {}, [`${entries.length} unbilled entr${entries.length === 1 ? 'y' : 'ies'}`]),
        el('span', {}, [formatRs(subtotal)]),
      ]),
      el('div', { class: 'bill-preview-row' }, [el('span', {}, ['Previous due']), el('span', {}, [formatRs(previousDue)])]),
      el('div', { class: 'bill-preview-row bill-preview-grand' }, [
        el('span', {}, ['Grand total']),
        el('span', {}, [formatRs(grandTotal)]),
      ]),
    ]),
    el('label', {}, ['Payment now (optional, Rs.)', paymentInput]),
    errorSlot,
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'submit' }, ['Generate Bill']),
    ]),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorSlot.replaceChildren();

    const raw = paymentInput.value.trim();
    const paymentNow = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(paymentNow) || paymentNow < 0) {
      errorSlot.append(errorBanner('Payment now must be zero or a positive number.'));
      return;
    }
    if (paymentNow > grandTotal) {
      errorSlot.append(errorBanner(`Payment now can\u2019t exceed the grand total of ${formatRs(grandTotal)}.`));
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = true;
    try {
      const bill = await window.khata.generateBill({ partyType, partyId, paymentNow });
      navigate(`/bills/${partyType}/${bill.id}`);
    } catch (err) {
      errorSlot.replaceChildren(errorBanner(errorMessage(err)));
      submitBtn.disabled = false;
    }
  });

  return form;
}

export async function renderPartyProfile(
  partyType: PartyType,
  partyId: number,
  container: HTMLElement
): Promise<void> {
  mount(container, loadingState('Loading profile...'));

  let party: Party;
  let entries: Entry[];
  let payments: Payment[];
  let bills: BillListItem[];
  try {
    [party, entries, payments, bills] = await Promise.all([
      window.khata.getParty({ partyType, partyId }),
      window.khata.listUnbilledEntries({ partyType, partyId }),
      window.khata.listPayments({ partyType, partyId }),
      window.khata.listBillsForParty({ partyType, partyId }),
    ]);
  } catch (err) {
    mount(container, backLink(partyType), errorBanner(errorMessage(err)));
    return;
  }

  const copy = COPY[partyType];
  const entriesWrap = el('div', {});
  const paymentsWrap = el('div', {});
  const billsWrap = el('div', {});
  const heroWrap = el('div', {});
  const generateBillWrap = el('div', {});
  const entryFormWrap = el('div', {});
  const paymentFormWrap = el('div', {});
  const deleteWrap = el('div', {});

  function refreshStatic() {
    mount(heroWrap, dueHero(party, partyType));
    renderEntriesTable(entriesWrap, entries, partyType, partyId, reload);
    mount(paymentsWrap, paymentsTable(payments));
    mount(billsWrap, billsTable(bills, partyType));
    mount(generateBillWrap, generateBillPanel(partyType, partyId, entries, party.current_due));
    mount(deleteWrap, deletePartyControls(party, partyType));
  }

  async function reload() {
    [party, entries, payments, bills] = await Promise.all([
      window.khata.getParty({ partyType, partyId }),
      window.khata.listUnbilledEntries({ partyType, partyId }),
      window.khata.listPayments({ partyType, partyId }),
      window.khata.listBillsForParty({ partyType, partyId }),
    ]);
    refreshStatic();
    // Forms read party.current_due / entries at build time, so they're
    // rebuilt fresh on every reload rather than mutated in place.
    paymentFormWrap.replaceChildren(paymentForm(partyType, partyId, party.current_due, reload));
    entryFormWrap.replaceChildren(addEntryForm(partyType, partyId, reload));
  }

  paymentFormWrap.replaceChildren(paymentForm(partyType, partyId, party.current_due, reload));
  entryFormWrap.replaceChildren(addEntryForm(partyType, partyId, reload));

  refreshStatic();

  mount(
    container,
    el('div', { class: 'profile-header-row' }, [backLink(partyType), deleteWrap]),
    heroWrap,
    el('div', { class: 'profile-columns' }, [
      el('section', { class: 'panel' }, [el('h2', {}, [copy.entryVerb]), entryFormWrap]),
      el('section', { class: 'panel' }, [el('h2', {}, ['Make a Payment']), paymentFormWrap]),
    ]),
    el('section', { class: 'panel' }, [el('h2', {}, [copy.addEntryLabel]), entriesWrap]),
    el('section', { class: 'panel' }, [el('h2', {}, ['Generate Bill']), generateBillWrap]),
    el('section', { class: 'panel' }, [el('h2', {}, ['Bill History']), billsWrap]),
    el('section', { class: 'panel' }, [el('h2', {}, ['Payment History']), paymentsWrap])
  );
}
