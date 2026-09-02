import { el, mount } from '../dom';
import { formatDate, formatDue } from '../format';
import { button, emptyState, errorBanner, errorMessage, loadingState, pageHeader, successBanner } from '../components';
import { navigate } from '../router';
import type { Party, PartyType, PartyWithActivity } from '../../main/types';

const COPY: Record<PartyType, { title: string; singular: string; addLabel: string; dueLabel: string; contactHint: string }> = {
  supplier: {
    title: 'Suppliers',
    singular: 'supplier',
    addLabel: 'Add Supplier',
    dueLabel: 'You owe',
    contactHint: 'e.g. 0300-1234567',
  },
  shopkeeper: {
    title: 'Shopkeepers',
    singular: 'shopkeeper',
    addLabel: 'Add Shopkeeper',
    dueLabel: 'You owe',
    contactHint: 'e.g. 0300-1234567',
  },
  customer: {
    title: 'Customers / Khata',
    singular: 'customer',
    addLabel: 'Add Customer',
    dueLabel: 'Owes you',
    contactHint: 'e.g. 0300-1234567',
  },
};

// Loose on purpose: accepts digits, spaces, dashes, and an optional leading
// '+'. The backend doesn't reject anything here, so this is just a nudge to
// catch obvious typos, not a hard gate.
const PHONE_RE = /^\+?[\d][\d\s-]{6,}$/;

function isValidContact(value: string): boolean {
  return value.trim() === '' || PHONE_RE.test(value.trim());
}

function renderTable(
  container: HTMLElement,
  parties: Party[],
  partyType: PartyType
): void {
  if (parties.length === 0) {
    mount(container, emptyState(`No ${COPY[partyType].singular}s yet. Use "${COPY[partyType].addLabel}" to add one.`));
    return;
  }

  const rows = parties.map((party) => {
    const due = formatDue(party.current_due);
    const row = el('tr', { class: 'clickable-row', tabindex: '0' }, [
      el('td', { class: 'cell-name' }, [party.name]),
      el('td', { class: 'cell-muted' }, [party.contact_number || '\u2014']),
      el('td', { class: `cell-amount cell-${due.kind}` }, [due.text]),
    ]);
    const go = () => navigate(`/${partyType}s/${party.id}`);
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') go();
    });
    return row;
  });

  const table = el('table', { class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Name']),
        el('th', {}, ['Contact']),
        el('th', { class: 'th-right' }, [COPY[partyType].dueLabel]),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);

  mount(container, table);
}

// A customer who hasn't purchased in this many days is considered
// "inactive" for the purpose of grouping - not a hard business rule, just
// a reasonable default for a shop with frequent repeat customers. Easy to
// adjust here if 30 days doesn't match how this shop actually runs.
const INACTIVE_DAYS_THRESHOLD = 30;

function daysSincePurchase(lastPurchaseDate: string | null): number {
  if (!lastPurchaseDate) return Infinity; // never purchased - treat as "as inactive as it gets"
  const datePart = lastPurchaseDate.split(' ')[0];
  const [y, m, d] = datePart.split('-').map(Number);
  const last = new Date(y, m - 1, d).getTime();
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.floor((todayMidnight - last) / (1000 * 60 * 60 * 24));
}

function isInactive(customer: PartyWithActivity): boolean {
  return daysSincePurchase(customer.last_purchase_date) >= INACTIVE_DAYS_THRESHOLD;
}

type CustomerSortMode = 'recent' | 'name';

function sortCustomers(customers: PartyWithActivity[], mode: CustomerSortMode): PartyWithActivity[] {
  const sorted = [...customers];
  if (mode === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } else {
    // Most recent purchase first; never-purchased customers sink to the
    // bottom, since Infinity always sorts last.
    sorted.sort((a, b) => daysSincePurchase(a.last_purchase_date) - daysSincePurchase(b.last_purchase_date));
  }
  return sorted;
}

function customerRow(customer: PartyWithActivity): HTMLElement {
  const due = formatDue(customer.current_due);
  const lastPurchase = customer.last_purchase_date ? formatDate(customer.last_purchase_date) : 'Never';
  const row = el('tr', { class: 'clickable-row', tabindex: '0' }, [
    el('td', { class: 'cell-name' }, [customer.name]),
    el('td', { class: 'cell-muted' }, [customer.contact_number || '\u2014']),
    el('td', { class: 'cell-muted' }, [lastPurchase]),
    el('td', { class: `cell-amount cell-${due.kind}` }, [due.text]),
  ]);
  const go = () => navigate(`/customers/${customer.id}`);
  row.addEventListener('click', go);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') go();
  });
  return row;
}

function customerTable(customers: PartyWithActivity[], emptyMessage: string): HTMLElement {
  if (customers.length === 0) {
    return emptyState(emptyMessage);
  }
  return el('table', { class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Name']),
        el('th', {}, ['Contact']),
        el('th', {}, ['Last Purchase']),
        el('th', { class: 'th-right' }, ['Owes you']),
      ]),
    ]),
    el('tbody', {}, customers.map(customerRow)),
  ]);
}

function renderCustomerLists(
  container: HTMLElement,
  customers: PartyWithActivity[],
  sortMode: CustomerSortMode
): void {
  if (customers.length === 0) {
    mount(container, emptyState(`No customers yet. Use "Add Customer" to add one.`));
    return;
  }

  const inactiveWithBalance = customers.filter((c) => c.current_due !== 0 && isInactive(c));
  const regular = customers.filter((c) => !(c.current_due !== 0 && isInactive(c)));

  const sections: HTMLElement[] = [customerTable(sortCustomers(regular, sortMode), 'No customers match.')];

  if (inactiveWithBalance.length > 0) {
    sections.push(
      el('div', { class: 'section-heading' }, [
        `Inactive \u2014 Balance Due (no purchase in ${INACTIVE_DAYS_THRESHOLD}+ days)`,
      ]),
      customerTable(sortCustomers(inactiveWithBalance, sortMode), '')
    );
  }

  mount(container, ...sections);
}

function addForm(partyType: PartyType, onCreated: () => void, onCancel: () => void): HTMLElement {
  const copy = COPY[partyType];
  const nameInput = el('input', { type: 'text', required: 'true', maxlength: '120' }) as HTMLInputElement;
  const contactInput = el('input', { type: 'text', placeholder: copy.contactHint, maxlength: '40' }) as HTMLInputElement;
  const openingDueInput = el('input', { type: 'number', step: '0.01', min: '0', placeholder: '0' }) as HTMLInputElement;
  const errorSlot = el('div', { class: 'form-error-slot' });

  const form = el('form', { class: 'inline-form' }, [
    el('div', { class: 'form-grid' }, [
      el('label', {}, ['Name', nameInput]),
      el('label', {}, ['Contact number (optional)', contactInput]),
      el('label', {}, [
        `Opening due (optional — existing balance before this app, in Rs.)`,
        openingDueInput,
      ]),
    ]),
    errorSlot,
    el('div', { class: 'form-actions' }, [
      button('Cancel', onCancel, 'secondary'),
      el('button', { class: 'btn btn-primary', type: 'submit' }, [`Save ${copy.singular}`]),
    ]),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorSlot.replaceChildren();

    const name = nameInput.value.trim();
    if (!name) {
      errorSlot.append(errorBanner('Name is required.'));
      return;
    }
    if (!isValidContact(contactInput.value)) {
      errorSlot.append(errorBanner('That contact number doesn\u2019t look right. Digits, spaces, and dashes only.'));
      return;
    }
    const openingDueRaw = openingDueInput.value.trim();
    const openingDue = openingDueRaw === '' ? 0 : Number(openingDueRaw);
    if (!Number.isFinite(openingDue) || openingDue < 0) {
      errorSlot.append(errorBanner('Opening due must be zero or a positive number.'));
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = true;
    try {
      await window.khata.createParty({
        partyType,
        name,
        contactNumber: contactInput.value.trim() || null,
        openingDue,
      });
      onCreated();
    } catch (err) {
      errorSlot.replaceChildren(errorBanner(errorMessage(err)));
      submitBtn.disabled = false;
    }
  });

  // First field should already have focus when the form appears.
  setTimeout(() => nameInput.focus(), 0);

  return form;
}

export async function renderPartyList(partyType: PartyType, container: HTMLElement): Promise<void> {
  const copy = COPY[partyType];
  mount(container, loadingState(`Loading ${copy.title.toLowerCase()}...`));

  // Suppliers keep the plain list (unchanged); customers additionally load
  // each one's most recent purchase date, needed for the recency sort and
  // the "inactive with balance" grouping below.
  let parties: Party[] = [];
  let customers: PartyWithActivity[] = [];
  try {
    if (partyType === 'customer') {
      customers = await window.khata.listPartiesWithActivity({ partyType });
    } else {
      parties = await window.khata.listParties({ partyType });
    }
  } catch (err) {
    mount(container, errorBanner(errorMessage(err)));
    return;
  }

  let showForm = false;
  let searchTerm = '';
  let closingBusy = false;
  let sortMode: CustomerSortMode = 'recent';

  const searchInput = el('input', {
    type: 'search',
    placeholder: `Search by name or contact...`,
    class: 'search-input',
  }) as HTMLInputElement;

  const sortSelect = el('select', { class: 'sort-select' }, [
    el('option', { value: 'recent' }, ['Sort: Most recent purchase']),
    el('option', { value: 'name' }, ['Sort: Name (A\u2013Z)']),
  ]) as HTMLSelectElement;

  const tableWrap = el('div', { class: 'table-wrap' });
  const formWrap = el('div', { class: 'form-wrap' });
  const feedbackWrap = el('div', { class: 'form-wrap' });

  function renderFiltered() {
    const term = searchTerm.trim().toLowerCase();
    if (partyType === 'customer') {
      const filtered = term
        ? customers.filter(
            (p) => p.name.toLowerCase().includes(term) || (p.contact_number ?? '').toLowerCase().includes(term)
          )
        : customers;
      renderCustomerLists(tableWrap, filtered, sortMode);
    } else {
      const filtered = term
        ? parties.filter(
            (p) => p.name.toLowerCase().includes(term) || (p.contact_number ?? '').toLowerCase().includes(term)
          )
        : parties;
      renderTable(tableWrap, filtered, partyType);
    }
  }

  async function refetch() {
    if (partyType === 'customer') {
      customers = await window.khata.listPartiesWithActivity({ partyType });
    } else {
      parties = await window.khata.listParties({ partyType });
    }
  }

  function renderForm() {
    formWrap.replaceChildren();
    if (!showForm) return;
    formWrap.append(
      addForm(
        partyType,
        async () => {
          showForm = false;
          await refetch();
          renderForm();
          renderFiltered();
        },
        () => {
          showForm = false;
          renderForm();
        }
      )
    );
  }

  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value;
    renderFiltered();
  });

  sortSelect.addEventListener('change', () => {
    sortMode = sortSelect.value as CustomerSortMode;
    renderFiltered();
  });

  const addBtn = button(copy.addLabel, () => {
    showForm = !showForm;
    renderForm();
  });

  const headerActions = [addBtn];

  if (partyType === 'customer') {
    const closingBtn = button('Closing', async () => {
      if (closingBusy) return;
      closingBusy = true;
      feedbackWrap.replaceChildren();
      closingBtn.disabled = true;
      closingBtn.textContent = 'Generating\u2026';
      try {
        const savedPath = await window.khata.generateCustomersClosingPdf();
        if (savedPath) {
          feedbackWrap.replaceChildren(successBanner(`Saved to ${savedPath}`));
        }
        // null savedPath means the shopkeeper cancelled the save dialog -
        // nothing was written, so no feedback needed either way.
      } catch (err) {
        feedbackWrap.replaceChildren(errorBanner(errorMessage(err)));
      } finally {
        closingBusy = false;
        closingBtn.disabled = false;
        closingBtn.textContent = 'Closing';
      }
    }, 'secondary');
    headerActions.push(closingBtn);
  }

  const toolbarChildren: HTMLElement[] = [searchInput];
  if (partyType === 'customer') toolbarChildren.push(sortSelect);

  mount(
    container,
    pageHeader(copy.title, headerActions),
    feedbackWrap,
    formWrap,
    el('div', { class: 'toolbar' }, toolbarChildren),
    tableWrap
  );

  renderFiltered();
}
