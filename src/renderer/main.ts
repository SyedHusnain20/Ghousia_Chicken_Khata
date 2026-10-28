import { buildShell } from './layout';
import { route, setNotFound, startRouter } from './router';
import { renderDashboard } from './views/dashboard';
import { renderPartyList } from './views/partyList';
import { renderPartyProfile } from './views/partyProfile';
import { renderBillDetail } from './views/billDetail';
import { renderBillsList } from './views/billsList';
import { renderPlaceholder } from './views/placeholder';
import { renderDailyLedger } from './views/dailyLedger';
import { renderDailyLedgerHistory } from './views/dailyLedgerHistory';
import { renderSettings } from './views/settings';
import { showLockScreen } from './views/lockScreen';
import { errorBanner, errorMessage } from './components';
import { todayIso } from './format';
import type { PartyType } from '../main/types';

const root = document.getElementById('app');
if (!root) {
  throw new Error('#app root element is missing from index.html');
}

// Everything below only runs once the app has been unlocked - see boot().
function startApp(appRoot: HTMLElement): void {
  const content = buildShell(appRoot);

  route('/', (_params, el) => {
    renderDashboard(el);
  });

  route('/suppliers', (_params, el) => {
    renderPartyList('supplier', el);
  });

  route('/suppliers/:id', (params, el) => {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      renderPlaceholder(el, 'Supplier not found', 'That supplier link doesn\u2019t look right.');
      return;
    }
    renderPartyProfile('supplier', id, el);
  });

  route('/customers', (_params, el) => {
    renderPartyList('customer', el);
  });

  route('/customers/:id', (params, el) => {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      renderPlaceholder(el, 'Customer not found', 'That customer link doesn\u2019t look right.');
      return;
    }
    renderPartyProfile('customer', id, el);
  });

  route('/shopkeepers', (_params, el) => {
    renderPartyList('shopkeeper', el);
  });

  route('/shopkeepers/:id', (params, el) => {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      renderPlaceholder(el, 'Shopkeeper not found', 'That shopkeeper link doesn\u2019t look right.');
      return;
    }
    renderPartyProfile('shopkeeper', id, el);
  });

  route('/waste-customers', (_params, el) => {
    renderPartyList('waste_customer', el);
  });

  route('/waste-customers/:id', (params, el) => {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      renderPlaceholder(el, 'Waste customer not found', 'That waste customer link doesn\u2019t look right.');
      return;
    }
    renderPartyProfile('waste_customer', id, el);
  });

  route('/ledger', (_params, el) => {
    renderDailyLedger(todayIso(), el);
  });

  route('/ledger/history', (_params, el) => {
    renderDailyLedgerHistory(el);
  });

  route('/ledger/:date', (params, el) => {
    renderDailyLedger(params.date, el);
  });

  route('/bills', (_params, el) => {
    renderBillsList(el);
  });

  route('/bills/:partyType/:id', (params, el) => {
    const id = Number(params.id);
    const partyType = params.partyType;
    const validTypes: PartyType[] = ['supplier', 'customer', 'shopkeeper', 'waste_customer'];
    if (!Number.isInteger(id) || !validTypes.includes(partyType as PartyType)) {
      renderPlaceholder(el, 'Bill not found', 'That bill link doesn\u2019t look right.');
      return;
    }
    renderBillDetail(partyType as PartyType, id, el);
  });

  route('/settings', (_params, el) => {
    renderSettings(el);
  });

  setNotFound((_params, el) => {
    renderPlaceholder(el, 'Not found', 'That page doesn\u2019t exist.');
  });

  startRouter(content);
}

// The main process decides whether the app is unlocked (it starts locked on
// every launch, and stays unlocked for as long as the app keeps running), so
// a page reload inside a running app skips straight through, while a fresh
// launch always shows the password screen first.
async function boot(appRoot: HTMLElement): Promise<void> {
  try {
    const status = await window.khata.getAuthStatus();
    if (!status.unlocked) {
      await showLockScreen(appRoot, status);
    }
  } catch (err) {
    appRoot.replaceChildren(errorBanner(errorMessage(err)));
    return;
  }
  appRoot.replaceChildren();
  startApp(appRoot);
}

void boot(root);
