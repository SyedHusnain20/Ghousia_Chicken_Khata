import { el } from '../dom';
import { mount } from '../dom';
import { formatDue, formatProfitLoss, formatRs, todayIso } from '../format';
import { errorBanner, errorMessage, loadingState } from '../components';
import type { Party } from '../../main/types';

function sumDue(parties: Party[]): number {
  return parties.reduce((sum, p) => sum + p.current_due, 0);
}

// Only positive dues count as "owed" - a party sitting in credit isn't
// owed money, so it shouldn't inflate this headline figure.
function sumOwed(parties: Party[]): number {
  return parties.reduce((sum, p) => sum + Math.max(p.current_due, 0), 0);
}

function summaryCard(label: string, valueText: string, kind: 'due' | 'credit' | 'clear' | 'neutral', href: string): HTMLElement {
  const card = el('a', { class: `summary-card summary-card-${kind}`, href }, [
    el('span', { class: 'summary-label' }, [label]),
    el('span', { class: 'summary-value' }, [valueText]),
  ]);
  return card;
}

function comingSoonCard(label: string, note: string, href: string): HTMLElement {
  return el('a', { class: 'summary-card summary-card-muted', href }, [
    el('span', { class: 'summary-label' }, [label]),
    el('span', { class: 'summary-value summary-value-small' }, [note]),
  ]);
}

export async function renderDashboard(container: HTMLElement): Promise<void> {
  mount(container, loadingState('Loading dashboard...'));

  let suppliers: Party[];
  let customers: Party[];
  try {
    [suppliers, customers] = await Promise.all([
      window.khata.listParties({ partyType: 'supplier' }),
      window.khata.listParties({ partyType: 'customer' }),
    ]);
  } catch (err) {
    mount(container, errorBanner(errorMessage(err)));
    return;
  }

  // No Daily Ledger row for today yet is an expected, everyday state (the
  // shopkeeper creates it once per business day) - not a real error, so
  // it's handled separately rather than through the errorBanner above.
  let todayProfitLossCard: HTMLElement;
  try {
    const todayLedger = await window.khata.getDailyLedger({ ledgerDate: todayIso() });
    const result = formatProfitLoss(todayLedger.profit_loss);
    todayProfitLossCard = summaryCard('Today\u2019s profit / loss', result.short, result.kind, '#/ledger');
  } catch {
    todayProfitLossCard = comingSoonCard('Today\u2019s profit / loss', 'No ledger yet today \u2014 tap to create it', '#/ledger');
  }

  const supplierOwed = sumOwed(suppliers);
  const customerOwed = sumOwed(customers);
  const netPosition = customerOwed - supplierOwed;

  const supplierDue = formatDue(supplierOwed);
  const customerDue = formatDue(customerOwed);

  const grid = el('div', { class: 'summary-grid' }, [
    summaryCard('You owe suppliers', supplierDue.text, supplierOwed > 0 ? 'due' : 'clear', '#/suppliers'),
    summaryCard('Customers owe you', customerDue.text, customerOwed > 0 ? 'credit' : 'clear', '#/customers'),
    summaryCard(
      'Net position',
      formatRs(Math.abs(netPosition)) + (netPosition >= 0 ? ' in your favor' : ' against you'),
      netPosition >= 0 ? 'credit' : 'due',
      '#/'
    ),
    todayProfitLossCard,
  ]);

  const counts = el('div', { class: 'stat-row' }, [
    el('div', { class: 'stat-pill' }, [`${suppliers.length} supplier${suppliers.length === 1 ? '' : 's'}`]),
    el('div', { class: 'stat-pill' }, [`${customers.length} customer${customers.length === 1 ? '' : 's'}`]),
  ]);

  mount(
    container,
    el('div', { class: 'page-header' }, [el('h1', {}, ['Dashboard'])]),
    grid,
    counts
  );
}
