import { el } from './dom';

// Errors thrown from the main process arrive as plain Error objects over
// IPC; this just guards against anything else showing up as "[object Object]".
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function errorBanner(message: string): HTMLElement {
  return el('div', { class: 'banner banner-error', role: 'alert' }, [message]);
}

export function loadingState(label = 'Loading...'): HTMLElement {
  return el('div', { class: 'state-message' }, [label]);
}

export function emptyState(message: string): HTMLElement {
  return el('div', { class: 'state-message state-empty' }, [message]);
}

export function pageHeader(title: string, actions?: HTMLElement[]): HTMLElement {
  return el('div', { class: 'page-header' }, [
    el('h1', {}, [title]),
    actions ? el('div', { class: 'page-header-actions' }, actions) : null,
  ]);
}

export function button(
  label: string,
  onClick: () => void,
  variant: 'primary' | 'secondary' | 'danger' = 'primary'
): HTMLButtonElement {
  const btn = el('button', { class: `btn btn-${variant}`, type: 'button' }, [label]);
  btn.addEventListener('click', onClick);
  return btn;
}
