// Verifies the REAL main-process wiring (ipcGuard + authIpcHandlers + every
// registerXxxIpcHandlers) with a stand-in for Electron's ipcMain: while the
// app is locked, every data channel must refuse to run, and only the auth
// channels may respond.
import fs from 'fs';
import os from 'os';
import path from 'path';

type Handler = (event: unknown, ...args: any[]) => unknown;
const handlers = new Map<string, Handler>();

const anything: any = new Proxy(function () {}, {
  get: () => anything,
  apply: () => anything,
  construct: () => anything,
});
const fakeElectron: any = new Proxy(
  { ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn), removeHandler: () => {} } },
  { get: (t: any, k: string) => (k in t ? t[k] : anything) }
);
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  return request === 'electron' ? fakeElectron : originalLoad.call(this, request, ...rest);
};

const { openDatabase } = require('../src/main/db/database');
const { AppLock } = require('../src/main/security/appLock');
const { setUnlockCheck } = require('../src/main/security/ipcGuard');
const { registerAuthIpcHandlers } = require('../src/main/authIpcHandlers');
const { registerIpcHandlers } = require('../src/main/ipcHandlers');
const { registerStorageIpcHandlers } = require('../src/main/storageIpcHandlers');
const { registerReportIpcHandlers } = require('../src/main/reportsIpcHandlers');
const { IpcChannels } = require('../src/shared/ipc');

function check(label: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${label}${pass ? '' : detail ? ` (${detail})` : ''}`);
  if (!pass) process.exitCode = 1;
}
async function outcome(channel: string, req?: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    await handlers.get(channel)!({}, req);
    return { ok: true, message: '' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-ipc-'));
const lock = new AppLock(path.join(dir, 'app-lock.json'));
const db = openDatabase(':memory:');

// Same order as main/index.ts: guard first (fail-closed default), then wire up.
registerAuthIpcHandlers(lock);
registerIpcHandlers(db);
registerStorageIpcHandlers(() => db, () => dir, () => null);
registerReportIpcHandlers(() => db, () => null);

(async () => {
  const allChannels: string[] = Object.values(IpcChannels);
  const authChannels = allChannels.filter((c) => c.startsWith('auth:'));
  const dataChannels = allChannels.filter((c) => !c.startsWith('auth:'));
  check('every channel in IpcChannels has a registered handler', allChannels.every((c) => handlers.has(c)),
    allChannels.filter((c) => !handlers.has(c)).join(', '));

  console.log('\n--- Before wiring the unlock check: fails closed ---');
  const failClosed = await outcome(IpcChannels.PARTY_LIST, { partyType: 'customer' });
  check('data channel refused when no unlock check is wired', !failClosed.ok && failClosed.message.includes('locked'));

  setUnlockCheck(() => lock.isUnlocked());

  console.log('\n--- Locked: every data channel refuses ---');
  for (const ch of dataChannels) {
    const r = await outcome(ch, {});
    check(`locked: ${ch} refused`, !r.ok && r.message.includes('locked'), r.message);
  }
  eqStatus('status while locked, no password yet', await handlers.get(IpcChannels.AUTH_GET_STATUS)!({}), { hasPassword: false, unlocked: false });

  console.log('\n--- Set up password: data channels open ---');
  await handlers.get(IpcChannels.AUTH_SETUP)!({}, { password: 'khata1', confirmPassword: 'khata1' });
  const listed = await outcome(IpcChannels.PARTY_LIST, { partyType: 'customer' });
  check('data channel works after setup', listed.ok, listed.message);

  console.log('\n--- New process: locked again, wrong password does not open anything ---');
  const lock2 = new AppLock(path.join(dir, 'app-lock.json'));
  setUnlockCheck(() => lock2.isUnlocked());
  registerAuthIpcHandlers(lock2); // re-register against the new "process"
  check('data channel refused again after restart', !(await outcome(IpcChannels.PARTY_LIST, { partyType: 'customer' })).ok);
  const wrong = await outcome(IpcChannels.AUTH_UNLOCK, { password: 'wrong' });
  check('wrong password rejected through the IPC handler', !wrong.ok && wrong.message.includes('Incorrect'));
  check('still refused after wrong password', !(await outcome(IpcChannels.PARTY_LIST, { partyType: 'customer' })).ok);
  const right = await outcome(IpcChannels.AUTH_UNLOCK, { password: 'khata1' });
  check('right password accepted', right.ok, right.message);
  check('data channel works after unlock', (await outcome(IpcChannels.PARTY_LIST, { partyType: 'customer' })).ok);

  const changed = await outcome(IpcChannels.AUTH_CHANGE_PASSWORD, {
    currentPassword: 'khata1', newPassword: 'khata2', confirmNewPassword: 'khata2',
  });
  check('change password through the IPC handler', changed.ok, changed.message);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(process.exitCode ? '\nSome checks FAILED.' : '\nAll IPC lock checks passed.');

  function eqStatus(label: string, actual: unknown, expected: unknown) {
    check(label, JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(actual));
  }
})();
