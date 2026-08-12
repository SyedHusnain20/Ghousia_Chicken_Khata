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
import { todayIso } from './format';

const root = document.getElementById('app');
if (!root) {
  throw new Error('#app root element is missing from index.html');
}

const content = buildShell(root);

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
  if (!Number.isInteger(id) || (partyType !== 'supplier' && partyType !== 'customer')) {
    renderPlaceholder(el, 'Bill not found', 'That bill link doesn\u2019t look right.');
    return;
  }
  renderBillDetail(partyType, id, el);
});

route('/settings', (_params, el) => {
  renderPlaceholder(el, 'Settings / Backup', 'Backup and restore tools are built in a later step of this project.');
});

setNotFound((_params, el) => {
  renderPlaceholder(el, 'Not found', 'That page doesn\u2019t exist.');
});

startRouter(content);
