import { el } from './dom';
import { ITEM_OPTIONS } from '../shared/items';

// Errors thrown from the main process arrive as plain Error objects over
// IPC; this just guards against anything else showing up as "[object Object]".
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Electron wraps an error thrown in the main process as "Error invoking
// remote method 'channel': Error: <message>". Screens where the message is
// shown straight to the shopkeeper (password prompts, restore bill) use this
// to show just the <message> part.
export function ipcErrorMessage(err: unknown): string {
  return errorMessage(err).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}

export function errorBanner(message: string): HTMLElement {
  return el('div', { class: 'banner banner-error', role: 'alert' }, [message]);
}

export function successBanner(message: string): HTMLElement {
  return el('div', { class: 'banner banner-success', role: 'status' }, [message]);
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

/**
 * Replacement for window.confirm(). Electron's synchronous JS dialogs
 * (window.confirm/alert/prompt) run through a native nested message loop
 * that, on some Windows setups, leaves the renderer's input event routing
 * broken after the dialog closes - text fields stop accepting keystrokes
 * and the only fix is restarting the app, even though everything else
 * still looks and clicks fine. This avoids that whole class of bug by
 * never using a native dialog at all - it's just an absolutely-positioned
 * overlay inside the page, so there's no nested message loop to leave the
 * window in a bad state.
 *
 * Same yes/no shape as window.confirm - resolves true if confirmed, false
 * if cancelled (via the Cancel button, clicking outside the box, or Esc).
 */
export function confirmDialog(
  message: string,
  options: { confirmLabel?: string; cancelLabel?: string; danger?: boolean } = {}
): Promise<boolean> {
  const { confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false } = options;

  return new Promise((resolve) => {
    const confirmBtn = el(
      'button',
      { class: `btn ${danger ? 'btn-danger' : 'btn-primary'} btn-small`, type: 'button' },
      [confirmLabel]
    ) as HTMLButtonElement;
    const cancelBtn = el('button', { class: 'btn btn-secondary btn-small', type: 'button' }, [
      cancelLabel,
    ]) as HTMLButtonElement;

    const box = el('div', { class: 'modal-box', role: 'alertdialog', 'aria-modal': 'true' }, [
      el('p', { class: 'modal-message' }, [message]),
      el('div', { class: 'form-actions' }, [confirmBtn, cancelBtn]),
    ]);
    const overlay = el('div', { class: 'modal-overlay' }, [box]);

    function close(result: boolean): void {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve(result);
    }

    function onKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    }

    confirmBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKeydown);

    document.body.append(overlay);
    confirmBtn.focus();
  });
}

/**
 * The item dropdown used by every form that picks an item (party purchase /
 * sale forms, entry editing, Counter Sale). The list lives in
 * shared/items.ts. When editing an old entry whose saved item isn't in the
 * list (it was typed freehand before the dropdown existed), that value is
 * kept as an extra option so opening and saving the entry doesn't silently
 * rename it.
 */
export function itemSelect(selected?: string): HTMLSelectElement {
  const options: string[] = [...ITEM_OPTIONS];
  if (selected && !options.includes(selected)) options.push(selected);
  const select = el(
    'select',
    { class: 'item-select', 'aria-label': 'Item' },
    options.map((name) => el('option', { value: name }, [name]))
  ) as HTMLSelectElement;
  select.value = selected && options.includes(selected) ? selected : options[0];
  return select;
}

/**
 * A small popup asking for one amount, pre-filled with `defaultValue`.
 * Resolves with the entered number, or null if cancelled. `max` (if given)
 * is enforced - the popup shows the problem and stays open instead of
 * closing on a bad value.
 */
export function amountPromptDialog(options: {
  title: string;
  message?: string;
  label: string;
  defaultValue: number;
  max?: number;
  confirmLabel?: string;
}): Promise<number | null> {
  const { title, message, label, defaultValue, max, confirmLabel = 'OK' } = options;

  return new Promise((resolve) => {
    const input = el('input', {
      type: 'number',
      step: '1',
      min: '0',
      value: String(defaultValue),
    }) as HTMLInputElement;
    const errorSlot = el('div', { class: 'form-error-slot' });
    const confirmBtn = el('button', { class: 'btn btn-primary btn-small', type: 'button' }, [confirmLabel]) as HTMLButtonElement;
    const cancelBtn = el('button', { class: 'btn btn-secondary btn-small', type: 'button' }, ['Cancel']) as HTMLButtonElement;

    const box = el('div', { class: 'modal-box', role: 'dialog', 'aria-modal': 'true' }, [
      el('h3', {}, [title]),
      message ? el('p', { class: 'modal-message' }, [message]) : null,
      el('label', {}, [label, input]),
      errorSlot,
      el('div', { class: 'form-actions' }, [confirmBtn, cancelBtn]),
    ]);
    const overlay = el('div', { class: 'modal-overlay' }, [box]);

    function close(result: number | null): void {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve(result);
    }

    function submit(): void {
      const value = Number(input.value);
      if (input.value.trim() === '' || !Number.isFinite(value) || value < 0) {
        errorSlot.replaceChildren(errorBanner('Enter an amount of zero or more.'));
        return;
      }
      if (max !== undefined && value > max) {
        errorSlot.replaceChildren(errorBanner(`The amount can't be more than ${max}.`));
        return;
      }
      close(value);
    }

    function onKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter') submit();
    }

    confirmBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    document.addEventListener('keydown', onKeydown);

    document.body.append(overlay);
    input.focus();
    input.select();
  });
}
