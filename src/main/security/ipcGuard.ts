import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

// Answers "has the shopkeeper unlocked the app yet?". Until index.ts wires
// this to the real AppLock it defaults to false, so if wiring is ever
// forgotten the app fails CLOSED (everything refused) rather than open.
let isUnlocked: () => boolean = () => false;

export function setUnlockCheck(check: () => boolean): void {
  isUnlocked = check;
}

/**
 * Drop-in replacement for ipcMain.handle() used by every data channel
 * (parties, entries, bills, payments, ledger, storage, reports). While the
 * app is locked, the call is refused in the main process itself - so the
 * lock isn't just a screen drawn over the UI; nothing can read or change
 * the books until the password has been entered. The auth:* channels use
 * plain ipcMain.handle() because they have to work while locked.
 */
export function guardedHandle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isUnlocked()) {
      throw new Error('The app is locked. Please enter your password.');
    }
    return listener(event, ...args);
  });
}
