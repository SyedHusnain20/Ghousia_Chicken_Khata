import { el } from './dom';

interface NavItem {
  path: string;
  label: string;
  icon: string; // single glyph, keeps nav scannable at a glance for a shopkeeper
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: '⌂' },
  { path: '/suppliers', label: 'Suppliers', icon: '🚚' },
  { path: '/customers', label: 'Customers / Khata', icon: '👥' },
  { path: '/ledger', label: 'Daily Ledger', icon: '📒' },
  { path: '/bills', label: 'Bills', icon: '🧾' },
  { path: '/settings', label: 'Settings / Backup', icon: '⚙' },
];

// Builds the sidebar + topbar once and returns the empty <main> element the
// router renders each screen into. Called exactly once from main.ts.
export function buildShell(root: HTMLElement): HTMLElement {
  const nav = el(
    'nav',
    { class: 'sidebar-nav' },
    NAV_ITEMS.map((item) =>
      el('a', { href: `#${item.path}`, class: 'nav-link', 'data-nav-link': '' }, [
        el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, [item.icon]),
        el('span', { class: 'nav-label' }, [item.label]),
      ])
    )
  );

  const sidebar = el('aside', { class: 'sidebar' }, [
    el('div', { class: 'brand' }, [
      el('span', { class: 'brand-name' }, ['Ghousia Chicken Khata']),
      el('span', { class: 'brand-tag' }, ['Local ledger — this laptop only']),
    ]),
    nav,
  ]);

  const main = el('main', { class: 'content', id: 'content' });

  root.append(sidebar, main);
  return main;
}
