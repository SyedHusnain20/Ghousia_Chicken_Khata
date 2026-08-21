import { el, mount } from '../dom';
import { formatDate, formatProfitLoss, formatRs, todayIso } from '../format';
import { emptyState, errorBanner, errorMessage, loadingState, pageHeader } from '../components';
import { navigate } from '../router';
import type { DailyLedgerDetail, EntryWithPartyName } from '../../main/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// getDailyLedger() throws this exact message (see dailyLedgerService.ts)
// when no ledger row has been created for the date yet. Matching on it
// lets the UI show a "start the ledger" prompt instead of a bare error.
function isMissingLedgerError(message: string): boolean {
  return message.includes('create it first');
}

function dateBar(ledgerDate: string): HTMLElement {
  const dateInput = el('input', { type: 'date', value: ledgerDate }) as HTMLInputElement;
  dateInput.addEventListener('change', () => {
    if (DATE_RE.test(dateInput.value)) navigate(`/ledger/${dateInput.value}`);
  });

  const todayBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, ['Today']);
  todayBtn.addEventListener('click', () => navigate(`/ledger/${todayIso()}`));

  const historyLink = el('a', { href: '#/ledger/history', class: 'back-link' }, ['View History \u2192']);

  return el('div', { class: 'ledger-date-bar' }, [
    el('label', { class: 'ledger-date-label' }, ['Date', dateInput]),
    todayBtn,
    el('div', { class: 'ledger-date-bar-spacer' }),
    historyLink,
  ]);
}

// Floors to a whole rupee, without pulling in main's floorMoney (that
// helper lives in a file that imports better-sqlite3 - fine for main, but
// that import must never end up in the renderer bundle). Every money
// amount in this app is a whole number of rupees - see partyService.ts's
// floorMoney for the full rationale.
function floorMoney(n: number): number {
  return Math.floor(n);
}

interface AggregatedPartyRow {
  party_name: string;
  weight_kg: number;
  rate_per_kg: number;
  line_total: number;
}

// The Daily Ledger shows one row per party per day, not one row per
// transaction - if Shan bought 17kg and later 12kg the same day, this
// merges that into a single 29kg row. When only ONE entry contributed to
// a row, its actual stored rate is used directly - reconstructing it via
// total/weight would introduce a rounding artifact, since the total was
// already floored to a whole rupee before that division (e.g. 70.1kg at
// Rs. 288 floors to Rs. 20,188, and 20,188/70.1 floors to 287, not 288).
// Only when multiple entries with genuinely different rates are merged
// into one row is there no single "real" rate to show, so that case falls
// back to the effective rate (total Rs. / total KG) - which still keeps
// Total = KG x Rate exactly true even then. This is purely a display
// grouping: the underlying entries stay separate everywhere else (party
// profile, billing), so nothing here is written back or deduplicated in
// the database.
function aggregateByParty(rows: EntryWithPartyName[]): AggregatedPartyRow[] {
  const order: number[] = [];
  const totals = new Map<
    number,
    { party_name: string; weight_kg: number; line_total: number; entryCount: number; firstRate: number }
  >();

  for (const r of rows) {
    const existing = totals.get(r.party_id);
    if (existing) {
      // weight_kg is a physical quantity, not money - never floored, only
      // summed exactly (JS float addition here is fine at this scale).
      existing.weight_kg = existing.weight_kg + r.weight_kg;
      existing.line_total = floorMoney(existing.line_total + r.line_total);
      existing.entryCount += 1;
    } else {
      totals.set(r.party_id, {
        party_name: r.party_name,
        weight_kg: r.weight_kg,
        line_total: r.line_total,
        entryCount: 1,
        firstRate: r.rate_per_kg,
      });
      order.push(r.party_id);
    }
  }

  return order.map((id) => {
    const t = totals.get(id)!;
    const rate_per_kg =
      t.entryCount === 1
        ? t.firstRate // exact match to the entry's real stored rate - no reconstruction needed
        : t.weight_kg > 0
          ? floorMoney(t.line_total / t.weight_kg)
          : 0;
    return {
      party_name: t.party_name,
      weight_kg: t.weight_kg,
      line_total: t.line_total,
      rate_per_kg,
    };
  });
}

// Shared table for both Supplier Purchases and Khata Customer Sales - same
// shape (party name / KG / rate / total), just a different party-column
// label and total-row caption. Fixed column widths (via .ledger-entries-table
// in style.css) keep the numeric columns lined up regardless of how wide
// any one party's name or amount happens to be.
function partyEntriesTable(
  rawRows: EntryWithPartyName[],
  partyColumnLabel: string,
  totalLabel: string,
  emptyLabel: string
): HTMLElement {
  if (rawRows.length === 0) {
    return emptyState(emptyLabel);
  }
  const rows = aggregateByParty(rawRows);
  const total = rows.reduce((sum, r) => sum + r.line_total, 0);
  return el('table', { class: 'data-table ledger-entries-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, [partyColumnLabel]),
        el('th', { class: 'th-right' }, ['KG']),
        el('th', { class: 'th-right' }, ['Rate']),
        el('th', { class: 'th-right' }, ['Total']),
      ]),
    ]),
    el(
      'tbody',
      {},
      rows.map((r) =>
        el('tr', {}, [
          el('td', { class: 'cell-name' }, [r.party_name]),
          el('td', { class: 'cell-number' }, [String(r.weight_kg)]),
          el('td', { class: 'cell-number' }, [formatRs(r.rate_per_kg)]),
          el('td', { class: 'cell-number cell-strong' }, [formatRs(r.line_total)]),
        ])
      )
    ),
    el('tfoot', {}, [
      el('tr', {}, [
        el('td', { colspan: '3' }, [totalLabel]),
        el('td', { class: 'cell-number cell-strong' }, [formatRs(total)]),
      ]),
    ]),
  ]);
}

function totalLine(label: string, amount: number, strong = false): HTMLElement {
  const valueSpan = el('span', strong ? { class: 'total-preview' } : {}, [formatRs(amount)]);
  return el('div', { class: 'total-preview-row' }, [`${label}: `, valueSpan]);
}

// The two manually-entered, single-number fields (spec sections 3 & 6).
// Both default to 0 and reject negative values before ever reaching the
// backend, which enforces the same rule again.
function manualFieldsForm(
  ledgerDate: string,
  extraExpenses: number,
  cashCustomerIncome: number,
  onSaved: () => void
): HTMLElement {
  const extraInput = el('input', {
    type: 'number',
    step: '0.01',
    min: '0',
    value: String(extraExpenses),
  }) as HTMLInputElement;
  const cashInput = el('input', {
    type: 'number',
    step: '0.01',
    min: '0',
    value: String(cashCustomerIncome),
  }) as HTMLInputElement;
  const errorSlot = el('div', { class: 'form-error-slot' });

  const form = el('form', { class: 'inline-form' }, [
    el('div', { class: 'form-grid form-grid-tight' }, [
      el('label', {}, ['Extra Expenses (Rs.)', extraInput]),
      el('label', {}, ['Cash Customers Total (Rs.)', cashInput]),
    ]),
    el('p', { class: 'field-hint' }, [
      'One combined total each \u2014 wages, ice, transport, electricity, etc. under Extra Expenses; all walk-in ' +
        'cash sales for the day under Cash Customers. Leave a field empty for Rs. 0.',
    ]),
    errorSlot,
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'submit' }, ['Save Daily Totals']),
    ]),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorSlot.replaceChildren();

    const extra = extraInput.value.trim() === '' ? 0 : Number(extraInput.value);
    const cash = cashInput.value.trim() === '' ? 0 : Number(cashInput.value);
    if (!Number.isFinite(extra) || extra < 0) {
      errorSlot.append(errorBanner('Extra Expenses must be zero or a positive number.'));
      return;
    }
    if (!Number.isFinite(cash) || cash < 0) {
      errorSlot.append(errorBanner('Cash Customers Total must be zero or a positive number.'));
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = true;
    try {
      await window.khata.updateDailyLedgerFields({
        ledgerDate,
        extraExpenses: extra,
        cashCustomerIncome: cash,
      });
      onSaved();
    } catch (err) {
      errorSlot.replaceChildren(errorBanner(errorMessage(err)));
    } finally {
      submitBtn.disabled = false;
    }
  });

  return form;
}

// The headline Profit/Loss card. Reuses the .due-hero styling (and its
// due/credit/clear color language) already established for party balances,
// since the semantics line up: profit = credit green, loss = due red.
function resultHero(totalIncome: number, totalExpenses: number): HTMLElement {
  const result = formatProfitLoss(totalIncome - totalExpenses);
  return el('div', { class: `due-hero due-hero-${result.kind}` }, [
    el('div', { class: 'due-hero-info' }, [
      el('h1', {}, ['Daily Result']),
      el('div', { class: 'due-hero-contact' }, [
        `Total Income ${formatRs(totalIncome)} \u2014 Total Expenses ${formatRs(totalExpenses)}`,
      ]),
    ]),
    el('div', { class: 'due-hero-amount' }, [
      el('span', { class: 'due-hero-label' }, [
        result.kind === 'clear' ? 'Result' : result.kind === 'credit' ? 'Profit' : 'Loss',
      ]),
      el('span', { class: 'due-hero-value' }, [
        result.kind === 'clear' ? formatRs(0) : formatRs(Math.abs(totalIncome - totalExpenses)),
      ]),
    ]),
  ]);
}

function createLedgerPrompt(ledgerDate: string, onCreated: () => void): HTMLElement {
  const errorSlot = el('div', { class: 'form-error-slot' });
  const startBtn = el('button', { class: 'btn btn-primary', type: 'button' }, [
    `Start Ledger for ${formatDate(ledgerDate)}`,
  ]) as HTMLButtonElement;

  startBtn.addEventListener('click', async () => {
    errorSlot.replaceChildren();
    startBtn.disabled = true;
    try {
      await window.khata.createDailyLedger({ ledgerDate });
      onCreated();
    } catch (err) {
      errorSlot.replaceChildren(errorBanner(errorMessage(err)));
      startBtn.disabled = false;
    }
  });

  return el('section', { class: 'panel' }, [
    el('h2', {}, ['No ledger yet for this date']),
    el('p', { class: 'field-hint' }, [
      'Starting it just opens the day for Extra Expenses and Cash Customers entry. Any supplier purchases or ' +
        'Khata sales already on file for this date will be pulled in automatically \u2014 nothing is duplicated.',
    ]),
    errorSlot,
    startBtn,
  ]);
}

export async function renderDailyLedger(ledgerDate: string, container: HTMLElement): Promise<void> {
  if (!DATE_RE.test(ledgerDate)) {
    mount(container, pageHeader('Daily Ledger'), errorBanner('That date link doesn\u2019t look right.'));
    return;
  }

  const bodyWrap = el('div', {});
  mount(container, pageHeader('Daily Ledger'), dateBar(ledgerDate), bodyWrap);
  mount(bodyWrap, loadingState('Loading ledger...'));

  async function load(): Promise<void> {
    let detail: DailyLedgerDetail;
    try {
      detail = await window.khata.getDailyLedger({ ledgerDate });
    } catch (err) {
      const message = errorMessage(err);
      if (isMissingLedgerError(message)) {
        mount(bodyWrap, createLedgerPrompt(ledgerDate, load));
      } else {
        mount(bodyWrap, errorBanner(message));
      }
      return;
    }

    mount(
      bodyWrap,
      resultHero(detail.total_income, detail.total_expenses),
      el('div', { class: 'profile-columns' }, [
        el('section', { class: 'panel' }, [
          el('h2', {}, ['Expenses']),
          partyEntriesTable(
            detail.supplier_purchases,
            'Supplier',
            'Supplier Purchases Total',
            'No supplier purchases recorded for this date.'
          ),
          totalLine('Extra Expenses', detail.extra_expenses),
          el('hr', { class: 'ledger-total-rule' }),
          totalLine('Total Expenses', detail.total_expenses, true),
        ]),
        el('section', { class: 'panel' }, [
          el('h2', {}, ['Income']),
          partyEntriesTable(
            detail.khata_sales,
            'Customer',
            'Khata Sales Total',
            'No Khata customer sales recorded for this date.'
          ),
          totalLine('Cash Customers', detail.cash_customer_income),
          el('hr', { class: 'ledger-total-rule' }),
          totalLine('Total Income', detail.total_income, true),
        ]),
      ]),
      el('section', { class: 'panel' }, [
        el('h2', {}, ['Extra Expenses & Cash Customers']),
        manualFieldsForm(ledgerDate, detail.extra_expenses, detail.cash_customer_income, load),
      ])
    );
  }

  await load();
}