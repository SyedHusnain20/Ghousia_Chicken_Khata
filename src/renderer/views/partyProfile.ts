import { el, mount } from '../dom';
import { formatDue, formatRs, formatDateTime, todayIso } from '../format';
import { confirmDialog, emptyState, errorBanner, errorMessage, loadingState } from '../components';
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
  shopkeeper: {
    title: 'Shopkeeper',
    entryVerb: 'Add Purchase',
    entryNoun: 'purchase',
    listPath: '/shopkeepers',
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
  const forceDeleteWrap = el('div', {});
  const deleteBtn = el('button', { class: 'btn btn-danger btn-small', type: 'button' }, [
    `Delete ${copy.title}`,
  ]) as HTMLButtonElement;

  function showForceDeleteOption() {
    const nameInput = el('input', { type: 'text', placeholder: `Type "${party.name}" to confirm` }) as HTMLInputElement;
    const forceBtn = el('button', { class: 'btn btn-danger btn-small', type: 'button' }, [
      'Permanently Delete Everything',
    ]) as HTMLButtonElement;
    const cancelBtn = el('button', { class: 'btn btn-secondary btn-small', type: 'button' }, ['Cancel']);
    const forceErrorSlot = el('div', { class: 'form-error-slot' });

    cancelBtn.addEventListener('click', () => forceDeleteWrap.replaceChildren());

    forceBtn.addEventListener('click', async () => {
      forceErrorSlot.replaceChildren();
      const finalConfirm = await confirmDialog(
        `This will PERMANENTLY delete ${party.name} and every purchase, sale, bill, and payment ever logged against them. ` +
          `This cannot be undone and will change past Daily Ledger totals for any day they appeared in. Are you absolutely sure?`,
        { confirmLabel: 'Delete Everything', danger: true }
      );
      if (!finalConfirm) return;

      forceBtn.disabled = true;
      try {
        await window.khata.forceDeleteParty({ partyType, partyId: party.id, confirmName: nameInput.value });
        navigate(copy.listPath);
      } catch (err) {
        forceErrorSlot.replaceChildren(errorBanner(errorMessage(err)));
        forceBtn.disabled = false;
      }
    });

    forceDeleteWrap.replaceChildren(
      el('div', { class: 'force-delete-box' }, [
        el('p', { class: 'field-hint' }, [
          `If ${party.name} was entered by mistake, you can permanently remove them and everything logged against them instead. This is not reversible.`,
        ]),
        el('div', { class: 'form-grid form-grid-tight' }, [el('label', {}, ['Confirm name', nameInput])]),
        forceErrorSlot,
        el('div', { class: 'form-actions' }, [forceBtn, cancelBtn]),
      ])
    );
  }

  deleteBtn.addEventListener('click', async () => {
    errorSlot.replaceChildren();
    forceDeleteWrap.replaceChildren();
    const confirmed = await confirmDialog(
      `Delete ${party.name}? This can\u2019t be undone. This only works if they have no outstanding balance and no transaction history yet.`,
      { confirmLabel: 'Delete', danger: true }
    );
    if (!confirmed) return;

    deleteBtn.disabled = true;
    try {
      await window.khata.deleteParty({ partyType, partyId: party.id });
      navigate(copy.listPath);
    } catch (err) {
      errorSlot.replaceChildren(errorBanner(errorMessage(err)));
      showForceDeleteOption();
      deleteBtn.disabled = false;
    }
  });

  return el('div', { class: 'profile-header-actions-wrap' }, [
    el('div', { class: 'profile-header-actions' }, [deleteBtn, errorSlot]),
    forceDeleteWrap,
  ]);
}

function dueHero(party: Party, partyType: PartyType): HTMLElement {
  const due = formatDue(party.current_due);
  const label = partyType === 'customer' ? 'Owes you' : 'You owe';
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

// addEntry() throws this exact marker (see partyService.ts's
// findPossibleDuplicateEntry) when the same party/item/weight/rate/date
// combination is already logged. Pulling the human-readable part out lets
// the form ask "are you sure?" instead of just showing it as a hard error -
// Electron's IPC layer sometimes wraps thrown messages (e.g. "Error
// invoking remote method ...: Error: <message>"), so this searches for the
// marker rather than assuming it's at the start of the string.
const DUPLICATE_ENTRY_MARKER = 'DUPLICATE_ENTRY::';
function duplicateWarningMessage(err: unknown): string | null {
  const msg = errorMessage(err);
  const idx = msg.indexOf(DUPLICATE_ENTRY_MARKER);
  if (idx === -1) return null;
  return msg.slice(idx + DUPLICATE_ENTRY_MARKER.length);
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
      await trySave(false);
    } finally {
      submitBtn.disabled = false;
    }

    async function trySave(confirmDuplicate: boolean): Promise<void> {
      try {
        await window.khata.addEntry({
          partyType,
          partyId,
          itemName: itemInput.value.trim() || 'Chicken',
          weightKg,
          ratePerKg,
          entryDate: dateInput.value,
          confirmDuplicate,
        });
        kgInput.value = '';
        rateInput.value = '';
        updatePreview();
        onSaved();
      } catch (err) {
        const dupWarning = duplicateWarningMessage(err);
        if (dupWarning && !confirmDuplicate) {
          // Not a hard error - ask before saving a possible double entry.
          if (await confirmDialog(dupWarning, { confirmLabel: 'Add Anyway' })) {
            await trySave(true);
          }
          return;
        }
        errorSlot.replaceChildren(errorBanner(errorMessage(err)));
      }
    }
  });

  return form;
}

function paymentForm(partyType: PartyType, partyId: number, currentDue: number, onSaved: () => void): HTMLElement {
  const methodSelect = el('select', {}, [
    el('option', { value: 'cash' }, ['Cash']),
    el('option', { value: 'online' }, ['Online']),
  ]) as HTMLSelectElement;
  const dateInput = el('input', { type: 'date', value: todayIso() }) as HTMLInputElement;
  const amountInput = el('input', { type: 'number', step: '0.01', min: '0.01', placeholder: '0' }) as HTMLInputElement;
  const errorSlot = el('div', { class: 'form-error-slot' });

  const hint = el('p', { class: 'field-hint' }, [
    currentDue > 0
      ? `Current due is ${formatRs(currentDue)}. Entering an amount reduces it right away.`
      : 'There is no outstanding due right now. A payment here will create a credit balance.',
  ]);

  const form = el('form', { class: 'inline-form' }, [
    el('div', { class: 'form-grid form-grid-tight' }, [
      el('label', {}, ['Method', methodSelect]),
      el('label', {}, ['Date', dateInput]),
      el('label', {}, ['Amount (Rs.)', amountInput]),
    ]),
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
    if (!dateInput.value) {
      errorSlot.append(errorBanner('Date is required.'));
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = true;
    try {
      await window.khata.recordPayment({
        partyType,
        partyId,
        amount,
        note: 'Standalone payment',
        paymentMethod: methodSelect.value as 'online' | 'cash',
        paymentDate: dateInput.value,
      });
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
    el('td', {}, [el('input', { type: 'checkbox', disabled: 'true' })]),
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
  selectedIds: Set<number>,
  onSelectionChange: () => void,
  onChanged: () => void
): void {
  if (entries.length === 0) {
    mount(wrap, emptyState('No unbilled entries yet.'));
    return;
  }

  let editingId: number | null = null;

  function render() {
    const selectAllCheckbox = el('input', { type: 'checkbox' }) as HTMLInputElement;
    selectAllCheckbox.checked = entries.length > 0 && entries.every((e) => selectedIds.has(e.id));
    selectAllCheckbox.addEventListener('change', () => {
      if (selectAllCheckbox.checked) {
        entries.forEach((e) => selectedIds.add(e.id));
      } else {
        entries.forEach((e) => selectedIds.delete(e.id));
      }
      render();
      onSelectionChange();
    });

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
          const confirmed = await confirmDialog(
            `Delete this ${entry.item_name} entry (${formatRs(entry.line_total)})? This can\u2019t be undone.`,
            { confirmLabel: 'Delete', danger: true }
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

        const rowCheckbox = el('input', { type: 'checkbox' }) as HTMLInputElement;
        rowCheckbox.checked = selectedIds.has(entry.id);
        rowCheckbox.addEventListener('change', () => {
          if (rowCheckbox.checked) selectedIds.add(entry.id);
          else selectedIds.delete(entry.id);
          selectAllCheckbox.checked = entries.every((e) => selectedIds.has(e.id));
          onSelectionChange();
        });

        rows.push(
          el('tr', {}, [
            el('td', {}, [rowCheckbox]),
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
            el('th', {}, [selectAllCheckbox]),
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
            el('td', {}, []),
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
  const methodLabel: Record<string, string> = { cash: 'Cash', online: 'Online' };
  const rows = payments.map((p) =>
    el('tr', {}, [
      el('td', {}, [formatDateTime(p.paid_at)]),
      el('td', { class: 'cell-muted' }, [p.payment_method ? methodLabel[p.payment_method] : '\u2014']),
      el('td', { class: 'cell-number cell-strong' }, [formatRs(p.amount)]),
      el('td', { class: 'cell-muted' }, [p.bill_id ? `Bill #${p.bill_id}` : p.note || 'Standalone']),
    ])
  );
  return el('table', { class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Date']),
        el('th', {}, ['Method']),
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
// printable bill on success. Only the entries currently checked in the
// table above (selectedIds) go into the bill - anything left unchecked
// stays unbilled for a later one.
const PAYMENT_METHOD_LABEL: Record<string, string> = { cash: 'Cash', online: 'Online' };

function renderPaymentsUnbilledTable(
  wrap: HTMLElement,
  payments: Payment[],
  selectedIds: Set<number>,
  onSelectionChange: () => void
): void {
  if (payments.length === 0) {
    mount(wrap, emptyState('No unbilled payments.'));
    return;
  }

  function render() {
    const selectAllCheckbox = el('input', { type: 'checkbox' }) as HTMLInputElement;
    selectAllCheckbox.checked = payments.length > 0 && payments.every((p) => selectedIds.has(p.id));
    selectAllCheckbox.addEventListener('change', () => {
      if (selectAllCheckbox.checked) {
        payments.forEach((p) => selectedIds.add(p.id));
      } else {
        payments.forEach((p) => selectedIds.delete(p.id));
      }
      render();
      onSelectionChange();
    });

    const rows = payments.map((payment) => {
      const rowCheckbox = el('input', { type: 'checkbox' }) as HTMLInputElement;
      rowCheckbox.checked = selectedIds.has(payment.id);
      rowCheckbox.addEventListener('change', () => {
        if (rowCheckbox.checked) selectedIds.add(payment.id);
        else selectedIds.delete(payment.id);
        selectAllCheckbox.checked = payments.every((p) => selectedIds.has(p.id));
        onSelectionChange();
      });

      return el('tr', {}, [
        el('td', {}, [rowCheckbox]),
        el('td', {}, [formatDateTime(payment.paid_at)]),
        el('td', { class: 'cell-muted' }, [payment.payment_method ? PAYMENT_METHOD_LABEL[payment.payment_method] : '\u2014']),
        el('td', { class: 'cell-number cell-strong' }, [formatRs(payment.amount)]),
      ]);
    });

    const total = payments.reduce((sum, p) => sum + p.amount, 0);
    mount(
      wrap,
      el('table', { class: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', {}, [selectAllCheckbox]),
            el('th', {}, ['Date']),
            el('th', {}, ['Method']),
            el('th', { class: 'th-right' }, ['Amount']),
          ]),
        ]),
        el('tbody', {}, rows),
        el('tfoot', {}, [
          el('tr', {}, [
            el('td', { colspan: '3' }, ['Unbilled payments total']),
            el('td', { class: 'cell-number cell-strong' }, [formatRs(total)]),
          ]),
        ]),
      ])
    );
  }

  render();
}

function generateBillPanel(
  partyType: PartyType,
  partyId: number,
  entries: Entry[],
  selectedEntryIds: Set<number>,
  payments: Payment[],
  selectedPaymentIds: Set<number>,
  currentDue: number
): HTMLElement {
  if (entries.length === 0 && payments.length === 0) {
    return el('p', { class: 'field-hint' }, [
      'There are no unbilled purchases/sales or payments yet, so there\u2019s nothing to put on a bill.',
    ]);
  }

  const selectedEntries = entries.filter((e) => selectedEntryIds.has(e.id));
  const selectedPayments = payments.filter((p) => selectedPaymentIds.has(p.id));

  if (selectedEntries.length === 0 && selectedPayments.length === 0) {
    return el('p', { class: 'field-hint' }, [
      'Nothing is selected. Check the purchases/sales and/or payments above you want to include, then come back here to generate the bill.',
    ]);
  }

  const subtotal = floorMoney(selectedEntries.reduce((sum, e) => sum + e.line_total, 0));
  const paymentsTotal = floorMoney(selectedPayments.reduce((sum, p) => sum + p.amount, 0));
  // Matches generateBill's exact formula: previousDue is the true balance
  // from BEFORE any currently-unbilled activity existed - currentDue,
  // backing out ALL unbilled entries and adding back ALL unbilled
  // payments (they already reduced currentDue when recorded, so undoing
  // that means adding them back), regardless of what's selected here.
  const allUnbilledEntriesTotal = floorMoney(entries.reduce((sum, e) => sum + e.line_total, 0));
  const allUnbilledPaymentsTotal = floorMoney(payments.reduce((sum, p) => sum + p.amount, 0));
  const previousDue = floorMoney(currentDue - allUnbilledEntriesTotal + allUnbilledPaymentsTotal);
  const grandTotal = floorMoney(previousDue + subtotal);
  const remainingDue = floorMoney(grandTotal - paymentsTotal);

  const errorSlot = el('div', { class: 'form-error-slot' });

  const previewRows: HTMLElement[] = [
    el('div', { class: 'bill-preview-row' }, [
      el('span', {}, [
        `${selectedEntries.length} selected entr${selectedEntries.length === 1 ? 'y' : 'ies'}${
          selectedEntries.length < entries.length ? ` (of ${entries.length} unbilled)` : ''
        }`,
      ]),
      el('span', {}, [formatRs(subtotal)]),
    ]),
    el('div', { class: 'bill-preview-row' }, [el('span', {}, ['Previous due']), el('span', {}, [formatRs(previousDue)])]),
    el('div', { class: 'bill-preview-row bill-preview-grand' }, [
      el('span', {}, ['Grand total']),
      el('span', {}, [formatRs(grandTotal)]),
    ]),
  ];
  if (selectedPayments.length > 0) {
    previewRows.push(
      el('div', { class: 'bill-preview-row' }, [
        el('span', {}, [
          `${selectedPayments.length} selected payment${selectedPayments.length === 1 ? '' : 's'}${
            selectedPayments.length < payments.length ? ` (of ${payments.length} unbilled)` : ''
          }`,
        ]),
        el('span', {}, [formatRs(paymentsTotal)]),
      ]),
      el('div', { class: 'bill-preview-row bill-preview-grand' }, [
        el('span', {}, ['Remaining due']),
        el('span', {}, [formatRs(remainingDue)]),
      ])
    );
  }

  const form = el('form', { class: 'inline-form' }, [
    el('div', { class: 'bill-preview' }, previewRows),
    errorSlot,
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'submit' }, ['Generate Bill']),
    ]),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorSlot.replaceChildren();

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = true;
    try {
      await trySave(false);
    } finally {
      submitBtn.disabled = false;
    }

    async function trySave(confirmDuplicates: boolean): Promise<void> {
      try {
        const bill = await window.khata.generateBill({
          partyType,
          partyId,
          entryIds: selectedEntries.map((e) => e.id),
          paymentIds: selectedPayments.map((p) => p.id),
          confirmDuplicates,
        });
        navigate(`/bills/${partyType}/${bill.id}`);
      } catch (err) {
        const dupWarning = duplicateWarningMessage(err);
        if (dupWarning && !confirmDuplicates) {
          if (await confirmDialog(dupWarning, { confirmLabel: 'Generate Anyway' })) {
            await trySave(true);
          }
          return;
        }
        errorSlot.replaceChildren(errorBanner(errorMessage(err)));
      }
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
  let unbilledPayments: Payment[];
  let payments: Payment[];
  let bills: BillListItem[];
  try {
    [party, entries, unbilledPayments, payments, bills] = await Promise.all([
      window.khata.getParty({ partyType, partyId }),
      window.khata.listUnbilledEntries({ partyType, partyId }),
      window.khata.listUnbilledPayments({ partyType, partyId }),
      window.khata.listPayments({ partyType, partyId }),
      window.khata.listBillsForParty({ partyType, partyId }),
    ]);
  } catch (err) {
    mount(container, backLink(partyType), errorBanner(errorMessage(err)));
    return;
  }

  const copy = COPY[partyType];
  const entriesWrap = el('div', {});
  const unbilledPaymentsWrap = el('div', {});
  const paymentsWrap = el('div', {});
  const billsWrap = el('div', {});
  const heroWrap = el('div', {});
  const generateBillWrap = el('div', {});
  const entryFormWrap = el('div', {});
  const paymentFormWrap = el('div', {});
  const deleteWrap = el('div', {});

  // Which unbilled entries/payments are checked for the next bill.
  // Defaults to "everything" whenever data is (re)fetched - matches the
  // old behavior (bill everything) unless the shopkeeper deliberately
  // unchecks specific ones for a partial bill.
  let selectedEntryIds = new Set<number>(entries.map((e) => e.id));
  let selectedPaymentIds = new Set<number>(unbilledPayments.map((p) => p.id));

  function renderBillPanel() {
    mount(
      generateBillWrap,
      generateBillPanel(
        partyType,
        partyId,
        entries,
        selectedEntryIds,
        unbilledPayments,
        selectedPaymentIds,
        party.current_due
      )
    );
  }

  function refreshStatic() {
    mount(heroWrap, dueHero(party, partyType));
    renderEntriesTable(entriesWrap, entries, partyType, partyId, selectedEntryIds, renderBillPanel, reload);
    renderPaymentsUnbilledTable(unbilledPaymentsWrap, unbilledPayments, selectedPaymentIds, renderBillPanel);
    mount(paymentsWrap, paymentsTable(payments));
    mount(billsWrap, billsTable(bills, partyType));
    renderBillPanel();
    mount(deleteWrap, deletePartyControls(party, partyType));
  }

  async function reload() {
    [party, entries, unbilledPayments, payments, bills] = await Promise.all([
      window.khata.getParty({ partyType, partyId }),
      window.khata.listUnbilledEntries({ partyType, partyId }),
      window.khata.listUnbilledPayments({ partyType, partyId }),
      window.khata.listPayments({ partyType, partyId }),
      window.khata.listBillsForParty({ partyType, partyId }),
    ]);
    selectedEntryIds = new Set(entries.map((e) => e.id));
    selectedPaymentIds = new Set(unbilledPayments.map((p) => p.id));
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
    el('section', { class: 'panel' }, [el('h2', {}, ['Payments (unbilled)']), unbilledPaymentsWrap]),
    el('section', { class: 'panel' }, [el('h2', {}, ['Generate Bill']), generateBillWrap]),
    el('section', { class: 'panel' }, [el('h2', {}, ['Bill History']), billsWrap]),
    el('section', { class: 'panel' }, [el('h2', {}, ['Payment History']), paymentsWrap])
  );
}
