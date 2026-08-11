import { el, mount } from '../dom';
import { formatDue } from '../format';
import { button, emptyState, errorBanner, errorMessage, loadingState, pageHeader } from '../components';
import { navigate } from '../router';
import type { Party, PartyType } from '../../main/types';

const COPY: Record<PartyType, { title: string; singular: string; addLabel: string; dueLabel: string; contactHint: string }> = {
  supplier: {
    title: 'Suppliers',
    singular: 'supplier',
    addLabel: 'Add Supplier',
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

  let parties: Party[];
  try {
    parties = await window.khata.listParties({ partyType });
  } catch (err) {
    mount(container, errorBanner(errorMessage(err)));
    return;
  }

  let showForm = false;
  let searchTerm = '';

  const searchInput = el('input', {
    type: 'search',
    placeholder: `Search by name or contact...`,
    class: 'search-input',
  }) as HTMLInputElement;

  const tableWrap = el('div', { class: 'table-wrap' });
  const formWrap = el('div', { class: 'form-wrap' });

  function renderFiltered() {
    const term = searchTerm.trim().toLowerCase();
    const filtered = term
      ? parties.filter(
          (p) => p.name.toLowerCase().includes(term) || (p.contact_number ?? '').toLowerCase().includes(term)
        )
      : parties;
    renderTable(tableWrap, filtered, partyType);
  }

  function renderForm() {
    formWrap.replaceChildren();
    if (!showForm) return;
    formWrap.append(
      addForm(
        partyType,
        async () => {
          showForm = false;
          parties = await window.khata.listParties({ partyType });
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

  const addBtn = button(copy.addLabel, () => {
    showForm = !showForm;
    renderForm();
  });

  mount(
    container,
    pageHeader(copy.title, [addBtn]),
    formWrap,
    el('div', { class: 'toolbar' }, [searchInput]),
    tableWrap
  );

  renderFiltered();
}
