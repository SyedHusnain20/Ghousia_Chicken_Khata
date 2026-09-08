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
