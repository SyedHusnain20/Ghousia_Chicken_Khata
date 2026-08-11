import { buildShell } from './layout';
import { route, setNotFound, startRouter } from './router';
import { renderDashboard } from './views/dashboard';
import { renderPartyList } from './views/partyList';
import { renderPartyProfile } from './views/partyProfile';
import { renderPlaceholder } from './views/placeholder';

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
  renderPlaceholder(el, 'Daily Ledger', 'The Daily Ledger screen is built in the next step of this project.');
});

route('/bills', (_params, el) => {
  renderPlaceholder(el, 'Bills', 'Bill generation and printing is built in the next step of this project.');
});

route('/settings', (_params, el) => {
  renderPlaceholder(el, 'Settings / Backup', 'Backup and restore tools are built in a later step of this project.');
});

setNotFound((_params, el) => {
  renderPlaceholder(el, 'Not found', 'That page doesn\u2019t exist.');
});

startRouter(content);
