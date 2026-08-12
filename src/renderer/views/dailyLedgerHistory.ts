import { el, mount } from '../dom';
import { formatDate, formatProfitLoss, formatRs, todayIso } from '../format';
import { emptyState, errorBanner, errorMessage, loadingState, pageHeader } from '../components';
import { navigate } from '../router';
import type { DailyLedgerSummary } from '../../main/types';
import type { MonthlySummary } from '../../shared/ipc';

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function historyTable(rows: DailyLedgerSummary[]): HTMLElement {
  if (rows.length === 0) {
    return emptyState('No Daily Ledgers in this range yet.');
  }
  const tableRows = rows.map((row) => {
    const result = formatProfitLoss(row.profit_loss);
    const tr = el('tr', { class: 'clickable-row', tabindex: '0' }, [
      el('td', {}, [formatDate(row.ledger_date)]),
      el('td', { class: 'cell-number' }, [formatRs(row.total_income)]),
      el('td', { class: 'cell-number' }, [formatRs(row.total_expenses)]),
      el('td', { class: `cell-number cell-strong cell-${result.kind}` }, [result.short]),
    ]);
    const go = () => navigate(`/ledger/${row.ledger_date}`);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') go();
    });
    return tr;
  });

  return el('table', { class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Date']),
        el('th', { class: 'th-right' }, ['Total Income']),
        el('th', { class: 'th-right' }, ['Total Expenses']),
        el('th', { class: 'th-right' }, ['Profit / Loss']),
      ]),
    ]),
    el('tbody', {}, tableRows),
  ]);
}

// Date-range filter (spec section 14: "Specific date / Date range /
// Month"). A single date is just a range where fromDate === toDate, so
// there's no need for a separate "specific date" control.
function filterBar(
  fromDate: string,
  toDate: string,
  onFilter: (fromDate: string, toDate: string) => void
): HTMLElement {
  const fromInput = el('input', { type: 'date', value: fromDate }) as HTMLInputElement;
  const toInput = el('input', { type: 'date', value: toDate }) as HTMLInputElement;

  const form = el('form', { class: 'inline-form ledger-filter-form' }, [
    el('div', { class: 'form-grid form-grid-tight' }, [
      el('label', {}, ['From', fromInput]),
      el('label', {}, ['To', toInput]),
    ]),
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'submit' }, ['Filter']),
    ]),
  ]);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (fromInput.value && toInput.value) onFilter(fromInput.value, toInput.value);
  });

  return form;
}

function monthlySummaryPanel(
  year: number,
  month: number,
  summary: MonthlySummary,
  onMonthChange: (year: number, month: number) => void
): HTMLElement {
  const monthInput = el('input', {
    type: 'month',
    value: `${year}-${String(month).padStart(2, '0')}`,
  }) as HTMLInputElement;
  monthInput.addEventListener('change', () => {
    const [y, m] = monthInput.value.split('-').map(Number);
    if (y && m) onMonthChange(y, m);
  });

  const result = formatProfitLoss(summary.total_profit_loss);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return el('section', { class: 'panel' }, [
    el('div', { class: 'panel-header-row' }, [
      el('h2', {}, [`Monthly Summary \u2014 ${monthLabel}`]),
      el('label', { class: 'ledger-date-label' }, ['Month', monthInput]),
    ]),
    el('div', { class: `summary-grid` }, [
      el('div', { class: 'summary-card summary-card-clear' }, [
        el('span', { class: 'summary-label' }, ['Total Income']),
        el('span', { class: 'summary-value' }, [formatRs(summary.total_income)]),
      ]),
      el('div', { class: 'summary-card summary-card-clear' }, [
        el('span', { class: 'summary-label' }, ['Total Expenses']),
        el('span', { class: 'summary-value' }, [formatRs(summary.total_expenses)]),
      ]),
      el('div', { class: `summary-card summary-card-${result.kind}` }, [
        el('span', { class: 'summary-label' }, [result.kind === 'credit' ? 'Total Profit' : result.kind === 'due' ? 'Total Loss' : 'Result']),
        el('span', { class: 'summary-value' }, [result.kind === 'clear' ? formatRs(0) : formatRs(Math.abs(summary.total_profit_loss))]),
      ]),
    ]),
  ]);
}

export async function renderDailyLedgerHistory(container: HTMLElement): Promise<void> {
  const backLink = el('a', { href: '#/ledger', class: 'back-link' }, ['\u2190 Today\u2019s Ledger']);
  mount(container, backLink, pageHeader('Daily Ledger History'), loadingState('Loading history...'));

  const { year: defaultYear, month: defaultMonth } = currentYearMonth();
  const defaultFrom = `${defaultYear}-${String(defaultMonth).padStart(2, '0')}-01`;
  const defaultTo = todayIso();

  const monthlyWrap = el('div', {});
  const filterWrap = el('div', {});
  const tableWrap = el('div', { class: 'table-wrap' });

  async function loadMonthly(year: number, month: number) {
    try {
      const summary = await window.khata.getMonthlySummary({ year, month });
      mount(monthlyWrap, monthlySummaryPanel(year, month, summary, loadMonthly));
    } catch (err) {
      mount(monthlyWrap, errorBanner(errorMessage(err)));
    }
  }

  async function loadHistory(fromDate: string, toDate: string) {
    mount(tableWrap, loadingState('Loading history...'));
    try {
      const rows = await window.khata.listDailyLedgers({ fromDate, toDate });
      mount(tableWrap, historyTable(rows));
    } catch (err) {
      mount(tableWrap, errorBanner(errorMessage(err)));
    }
    mount(filterWrap, filterBar(fromDate, toDate, loadHistory));
  }

  mount(filterWrap, filterBar(defaultFrom, defaultTo, loadHistory));

  mount(
    container,
    backLink,
    pageHeader('Daily Ledger History'),
    monthlyWrap,
    filterWrap,
    tableWrap
  );

  await Promise.all([loadMonthly(defaultYear, defaultMonth), loadHistory(defaultFrom, defaultTo)]);
}
