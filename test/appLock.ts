import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppLock, MIN_PASSWORD_LENGTH } from '../src/main/security/appLock';

function check(label: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${label}${pass ? '' : detail ? ` (${detail})` : ''}`);
  if (!pass) process.exitCode = 1;
}
function throws(label: string, fn: () => unknown, messagePart: string) {
  try {
    fn();
    check(label, false, 'did not throw');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(label, msg.includes(messagePart), `threw "${msg}"`);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-lock-'));
const file = path.join(dir, 'app-lock.json');
let clock = 1_000_000;
const newProcess = () => new AppLock(file, () => clock); // a fresh AppLock == the app being started again

console.log('--- First launch: no password yet ---');
let lock = newProcess();
check('no password, locked', !lock.hasPassword() && !lock.isUnlocked());
throws('cannot unlock before a password exists', () => lock.unlock('whatever'), 'No password');
throws('too-short password rejected', () => lock.setInitialPassword('abc', 'abc'), `at least ${MIN_PASSWORD_LENGTH}`);
throws('mismatched confirmation rejected', () => lock.setInitialPassword('secret1', 'secret2'), 'don\u2019t match');
check('rejected attempts stored nothing', !lock.hasPassword());
lock.setInitialPassword('secret1', 'secret1');
check('after setup: password exists and app is unlocked', lock.hasPassword() && lock.isUnlocked());
const raw = fs.readFileSync(file, 'utf-8');
check('password is not stored in plain text', !raw.includes('secret1'));
throws('setup cannot be run again to overwrite the password', () => lock.setInitialPassword('hacked', 'hacked'), 'already been set');

console.log('\n--- App started again (new process): locked until the password is entered ---');
lock = newProcess();
check('has password but starts locked', lock.hasPassword() && !lock.isUnlocked());
throws('wrong password refused', () => lock.unlock('nope'), 'Incorrect password');
check('still locked after wrong password', !lock.isUnlocked());
lock.unlock('secret1');
check('correct password unlocks', lock.isUnlocked());
lock.unlock('secret1');
check('unlock stays true for the life of the process (minimize/reload never re-lock)', lock.isUnlocked());

console.log('\n--- Change password ---');
lock = newProcess();
throws('cannot change password while locked', () => lock.changePassword('secret1', 'newpass', 'newpass'), 'locked');
lock.unlock('secret1');
throws('wrong current password', () => lock.changePassword('WRONG', 'newpass', 'newpass'), 'Current password is incorrect');
throws('new password too short', () => lock.changePassword('secret1', 'ab', 'ab'), `at least ${MIN_PASSWORD_LENGTH}`);
throws('confirmation mismatch', () => lock.changePassword('secret1', 'newpass', 'newpasx'), 'don\u2019t match');
throws('new same as current', () => lock.changePassword('secret1', 'secret1', 'secret1'), 'different');
lock.changePassword('secret1', 'newpass', 'newpass');
check('change succeeded and app remains unlocked', lock.isUnlocked());
lock = newProcess();
throws('old password no longer works after restart', () => lock.unlock('secret1'), 'Incorrect password');
lock.unlock('newpass');
check('new password works after restart', lock.isUnlocked());
check('no temp file left behind', !fs.existsSync(`${file}.tmp`));

console.log('\n--- Unicode / spaces ---');
lock.changePassword('newpass', ' \u0645\u06CC\u0631\u0627 pass ', ' \u0645\u06CC\u0631\u0627 pass ');
lock = newProcess();
lock.unlock(' \u0645\u06CC\u0631\u0627 pass ');
check('Urdu + surrounding spaces preserved exactly', lock.isUnlocked());

console.log('\n--- Throttling after repeated wrong passwords ---');
lock = newProcess();
for (let i = 1; i <= 4; i++) throws(`wrong attempt ${i}`, () => lock.unlock('bad'), 'Incorrect password');
throws('5th wrong attempt triggers the wait', () => lock.unlock('bad'), 'Too many wrong attempts');
throws('even the CORRECT password is refused during the wait', () => lock.unlock(' \u0645\u06CC\u0631\u0627 pass '), 'Too many wrong attempts');
check('still locked during the wait', !lock.isUnlocked());
clock += 31_000;
lock.unlock(' \u0645\u06CC\u0631\u0627 pass ');
check('correct password works once the wait is over', lock.isUnlocked());

console.log('\n--- Damaged file ---');
fs.writeFileSync(file, '{not json');
lock = newProcess();
check('unreadable file is treated as "no password set" (setup screen shown)', !lock.hasPassword());

fs.rmSync(dir, { recursive: true, force: true });
console.log(process.exitCode ? '\nSome checks FAILED.' : '\nAll app-lock checks passed.');
