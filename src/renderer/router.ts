// Minimal hash router. No framework, no build-time route table - just a
// list of patterns checked in order. Good enough for the ~8 screens this
// app needs; revisit only if that count grows a lot.

export type RouteParams = Record<string, string>;
export type RouteHandler = (params: RouteParams, container: HTMLElement) => void;

interface Route {
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];
let container: HTMLElement | null = null;
let notFoundHandler: RouteHandler = (_params, el) => {
  el.textContent = 'Page not found.';
};

// '/suppliers/:id' -> matches '/suppliers/12', capturing { id: '12' }
function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const pattern = path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { pattern: new RegExp(`^${pattern}$`), keys };
}

export function route(path: string, handler: RouteHandler): void {
  const { pattern, keys } = compile(path);
  routes.push({ pattern, keys, handler });
}

export function setNotFound(handler: RouteHandler): void {
  notFoundHandler = handler;
}

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash === '' ? '/' : hash;
}

export function navigate(path: string): void {
  if (currentPath() === path) {
    render();
    return;
  }
  window.location.hash = path;
}

function render(): void {
  if (!container) return;
  const path = currentPath();

  for (const r of routes) {
    const match = path.match(r.pattern);
    if (!match) continue;
    const params: RouteParams = {};
    r.keys.forEach((key, i) => {
      params[key] = decodeURIComponent(match[i + 1]);
    });
    r.handler(params, container);
    highlightNav(path);
    return;
  }

  notFoundHandler({}, container);
  highlightNav(path);
}

// Marks the matching sidebar link as active by comparing its href's hash
// to the current path's first segment (so '/suppliers/12' still highlights
// the '/suppliers' nav link).
function highlightNav(path: string): void {
  const section = '/' + (path.split('/')[1] ?? '');
  document.querySelectorAll<HTMLAnchorElement>('[data-nav-link]').forEach((link) => {
    const target = link.getAttribute('href')?.replace(/^#/, '') ?? '';
    link.classList.toggle('active', target === section || (target === '/' && section === '/'));
  });
}

export function startRouter(rootContainer: HTMLElement): void {
  container = rootContainer;
  window.addEventListener('hashchange', render);
  render();
}
