import { el } from '../dom';
import { errorBanner, ipcErrorMessage } from '../components';
import { SHOP_NAME_EN } from '../shopConfig';
import type { AuthStatus } from '../../shared/ipc';

// Keep in sync with MIN_PASSWORD_LENGTH in src/main/security/appLock.ts.
// The main process is what actually enforces it - this copy only exists so
// the shopkeeper gets instant feedback without a round trip.
export const MIN_PASSWORD_LENGTH = 4;

function passwordInput(autocomplete: 'current-password' | 'new-password'): HTMLInputElement {
  return el('input', { type: 'password', autocomplete, spellcheck: 'false' }) as HTMLInputElement;
}

/**
 * Full-window password screen shown before anything else in the app.
 *
 * - First ever launch (no password set yet): asks the shopkeeper to choose
 *   one, twice.
 * - Every launch after that: asks for the password.
 *
 * Resolves once the main process has accepted the password. The rest of the
 * app (sidebar, routes, data) is not built until then. Whether the app is
 * unlocked is decided and remembered by the main process, not here, so
 * minimizing, switching windows or reloading the page never brings this
 * screen back - only starting the app again does.
 */
export function showLockScreen(root: HTMLElement, status: AuthStatus): Promise<void> {
  return new Promise((resolve) => {
    const isSetup = !status.hasPassword;

    const passwordField = passwordInput(isSetup ? 'new-password' : 'current-password');
    const confirmField = isSetup ? passwordInput('new-password') : null;
    const errorSlot = el('div', { class: 'form-error-slot' });
    const submitBtn = el('button', { class: 'btn btn-primary lock-submit', type: 'submit' }, [
      isSetup ? 'Set password' : 'Unlock',
    ]) as HTMLButtonElement;

    const form = el('form', { class: 'lock-form' }, [
      el('label', {}, [isSetup ? 'New password' : 'Password', passwordField]),
      confirmField ? el('label', {}, ['Confirm password', confirmField]) : null,
      errorSlot,
      submitBtn,
    ]);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorSlot.replaceChildren();

      const password = passwordField.value;
      if (isSetup) {
        if (password.length < MIN_PASSWORD_LENGTH) {
          errorSlot.append(errorBanner(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`));
          return;
        }
        if (password !== confirmField!.value) {
          errorSlot.append(errorBanner('The passwords you entered don\u2019t match.'));
          return;
        }
      } else if (password.length === 0) {
        errorSlot.append(errorBanner('Please enter your password.'));
        return;
      }

      submitBtn.disabled = true;
      try {
        if (isSetup) {
          await window.khata.setupPassword({ password, confirmPassword: confirmField!.value });
        } else {
          await window.khata.unlockApp({ password });
        }
        resolve();
      } catch (err) {
        errorSlot.append(errorBanner(ipcErrorMessage(err)));
        passwordField.value = '';
        if (confirmField) confirmField.value = '';
        submitBtn.disabled = false;
        passwordField.focus();
      }
    });

    const screen = el('div', { class: 'lock-screen' }, [
      el('div', { class: 'lock-card' }, [
        el('div', { class: 'lock-icon', 'aria-hidden': 'true' }, ['\uD83D\uDD12']),
        el('h1', {}, [SHOP_NAME_EN]),
        el('p', { class: 'lock-subtitle' }, [
          isSetup
            ? 'Set a password to protect your khata. You\u2019ll be asked for it each time the app is opened.'
            : 'Enter your password to open the khata.',
        ]),
        form,
      ]),
    ]);

    root.replaceChildren(screen);
    passwordField.focus();
  });
}
