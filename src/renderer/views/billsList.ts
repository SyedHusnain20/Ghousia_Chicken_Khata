import { el, mount } from '../dom';
import { formatDateTime, formatRs, formatShopkeeperBalance } from '../format';
import { emptyState, errorBanner, errorMessage, loadingState, pageHeader } from '../components';
import { navigate } from '../router';
import type { BillListItem, PartyType } from '../../main/types';

type FilterValue = 'all' | PartyType;

function filterTabs(active: FilterValue, onChange: (value: FilterValue) => void): HTMLElement {
  const options: { value: FilterValue; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'supplier', label: 'Suppliers' },
    { value: 'shopkeeper', label: 'Shopkeepers' },
    { value: 'customer', label: 'Customers' },
    { value: 'waste_customer', label: 'Waste Customers' },
  ];
  return el(
    'div',
    { class: 'filter-tabs' },
    options.map((opt) => {
      const tab = el('button', { type: 'button', class: `filter-tab${opt.value === active ? ' active' : ''}` }, [
        opt.label,
      ]);
      tab.addEventListener('click', () => onChange(opt.value));
      return tab;
    })
  );
}

// Shopkeeper bills hold a net figure that can be negative (they owe the shop),
// so show it as receivable (green) / payable (red) rather than "Rs. -500".
function amountCell(bill: BillListItem, value: number, strong: boolean): HTMLElement {
  const base = strong ? 'cell-number cell-strong' : 'cell-number';
  if (bill.party_type !== 'shopkeeper') return el('td', { class: base }, [formatRs(value)]);
  const b = formatShopkeeperBalance(value);
  const word = b.kind === 'credit' ? ' receivable' : b.kind === 'due' ? ' payable' : '';
  return el('td', { class: `${base} cell-${b.kind}` }, [`${b.text}${word}`]);
}

function billsTable(bills: BillListItem[]): HTMLElement {
  if (bills.length === 0) {
    return emptyState('No bills generated yet.');
  }
  const partyLabel: Record<PartyType, string> = {
    supplier: 'Supplier',
    customer: 'Customer',
    shopkeeper: 'Shopkeeper',
    waste_customer: 'Waste Customer',
  };
  const rows = bills.map((bill) => {
    const row = el('tr', { class: 'clickable-row', tabindex: '0' }, [
      el('td', {}, [formatDateTime(bill.bill_date)]),
      el('td', {}, [
        el('span', { class: `type-badge type-badge-${bill.party_type}` }, [partyLabel[bill.party_type]]),
      ]),
      el('td', { class: 'cell-name' }, [bill.party_name]),
      // For a shopkeeper the subtotal is purchases minus sales, so its sign
      // is the opposite of the balance's: flip it to read the same way.
      amountCell(bill, bill.party_type === 'shopkeeper' ? -bill.subtotal : bill.subtotal, false),
      amountCell(bill, bill.remaining_due, true),
    ]);
    const go = () => navigate(`/bills/${bill.party_type}/${bill.id}`);
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
        el('th', {}, ['Type']),
        el('th', {}, ['Party']),
        el('th', { class: 'th-right' }, ['Bill subtotal']),
        el('th', { class: 'th-right' }, ['Remaining due']),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

export async function renderBillsList(container: HTMLElement): Promise<void> {
  mount(container, loadingState('Loading bills...'));

  let allBills: BillListItem[];
  try {
    allBills = await window.khata.listAllBills({});
  } catch (err) {
    mount(container, errorBanner(errorMessage(err)));
    return;
  }

  let filter: FilterValue = 'all';
  const tabsWrap = el('div', {});
  const tableWrap = el('div', { class: 'table-wrap' });

  function renderList() {
    const filtered = filter === 'all' ? allBills : allBills.filter((b) => b.party_type === filter);
    mount(tableWrap, billsTable(filtered));
    mount(
      tabsWrap,
      filterTabs(filter, (value) => {
        filter = value;
        renderList();
      })
    );
  }

  renderList();

  mount(container, pageHeader('Bills'), tabsWrap, tableWrap);
}
