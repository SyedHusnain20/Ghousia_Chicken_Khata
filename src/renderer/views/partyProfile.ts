import { el, mount } from '../dom';
import { formatDue, formatRs, formatDateTime, todayIso } from '../format';
import { emptyState, errorBanner, errorMessage, loadingState } from '../components';
import type { Entry, Party, PartyType, Payment } from '../../main/types';

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
    const total = Number.isFinite(kg) && Number.isFinite(rate) ? kg * rate : 0;
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

function entriesTable(entries: Entry[]): HTMLElement {
  if (entries.length === 0) {
    return emptyState('No unbilled entries yet.');
  }
  const rows = entries.map((entry) =>
    el('tr', {}, [
      el('td', {}, [formatDateTime(entry.entry_date)]),
      el('td', {}, [entry.item_name]),
      el('td', { class: 'cell-number' }, [String(entry.weight_kg)]),
      el('td', { class: 'cell-number' }, [formatRs(entry.rate_per_kg)]),
      el('td', { class: 'cell-number cell-strong' }, [formatRs(entry.line_total)]),
    ])
  );
  const total = entries.reduce((sum, e) => sum + e.line_total, 0);
  return el('table', { class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Date']),
        el('th', {}, ['Item']),
        el('th', { class: 'th-right' }, ['KG']),
        el('th', { class: 'th-right' }, ['Rate']),
        el('th', { class: 'th-right' }, ['Total']),
      ]),
    ]),
    el('tbody', {}, rows),
    el('tfoot', {}, [
      el('tr', {}, [
        el('td', { colspan: '4' }, ['Unbilled subtotal']),
        el('td', { class: 'cell-number cell-strong' }, [formatRs(total)]),
      ]),
    ]),
  ]);
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

export async function renderPartyProfile(
  partyType: PartyType,
  partyId: number,
  container: HTMLElement
): Promise<void> {
  mount(container, loadingState('Loading profile...'));

  let party: Party;
  let entries: Entry[];
  let payments: Payment[];
  try {
    [party, entries, payments] = await Promise.all([
      window.khata.getParty({ partyType, partyId }),
      window.khata.listUnbilledEntries({ partyType, partyId }),
      window.khata.listPayments({ partyType, partyId }),
    ]);
  } catch (err) {
    mount(container, backLink(partyType), errorBanner(errorMessage(err)));
    return;
  }

  const copy = COPY[partyType];
  const entriesWrap = el('div', {});
  const paymentsWrap = el('div', {});
  const heroWrap = el('div', {});

  function refreshStatic() {
    mount(heroWrap, dueHero(party, partyType));
    mount(entriesWrap, entriesTable(entries));
    mount(paymentsWrap, paymentsTable(payments));
  }

  async function reload() {
    [party, entries, payments] = await Promise.all([
      window.khata.getParty({ partyType, partyId }),
      window.khata.listUnbilledEntries({ partyType, partyId }),
      window.khata.listPayments({ partyType, partyId }),
    ]);
    refreshStatic();
  }

  const entryFormWrap = el('div', {}, [addEntryForm(partyType, partyId, reload)]);
  const paymentFormWrap = el('div', {}, [paymentForm(partyType, partyId, party.current_due, reload)]);

  // Payment form needs the latest current_due each time the profile
  // changes, so it's rebuilt on reload rather than mutated in place.
  const originalReload = reload;
  async function reloadAndRebuildPaymentForm() {
    await originalReload();
    paymentFormWrap.replaceChildren(paymentForm(partyType, partyId, party.current_due, reloadAndRebuildPaymentForm));
  }
  paymentFormWrap.replaceChildren(paymentForm(partyType, partyId, party.current_due, reloadAndRebuildPaymentForm));
  entryFormWrap.replaceChildren(addEntryForm(partyType, partyId, reloadAndRebuildPaymentForm));

  refreshStatic();

  const generateBillNote = el('p', { class: 'field-hint' }, [
    'Generating a bill for these unbilled entries is coming in the next step.',
  ]);

  mount(
    container,
    backLink(partyType),
    heroWrap,
    el('div', { class: 'profile-columns' }, [
      el('section', { class: 'panel' }, [
        el('h2', {}, [copy.entryVerb]),
        entryFormWrap,
      ]),
      el('section', { class: 'panel' }, [
        el('h2', {}, ['Make a Payment']),
        paymentFormWrap,
      ]),
    ]),
    el('section', { class: 'panel' }, [
      el('div', { class: 'panel-header-row' }, [
        el('h2', {}, [copy.addEntryLabel]),
        el('span', { class: 'bill-btn-disabled', title: 'Coming soon' }, ['Generate Bill \u2192']),
      ]),
      generateBillNote,
      entriesWrap,
    ]),
    el('section', { class: 'panel' }, [el('h2', {}, ['Payment History']), paymentsWrap])
  );
}
