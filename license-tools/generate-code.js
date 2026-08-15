// Run this on YOUR OWN machine only - never ship or run this on a
// client's PC. Takes a Machine ID (the client sends you this from the
// app's activation screen) and produces the matching activation code,
// signed with your private key.
//
// Usage:
//   node license-tools/generate-code.js <machine-id>
//
// Requires license-tools/private-key.pem to exist locally (see
// license-tools/README.md for how it was generated) - this file must
// NEVER be committed to git.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const machineId = process.argv[2];
if (!machineId) {
  console.error('Usage: node generate-code.js <machine-id>');
  process.exit(1);
}

const privateKeyPath = path.join(__dirname, 'private-key.pem');
if (!fs.existsSync(privateKeyPath)) {
  console.error(`Private key not found at ${privateKeyPath}`);
  console.error('See license-tools/README.md.');
  process.exit(1);
}

const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath, 'utf-8'));
const signature = crypto.sign(null, Buffer.from(machineId.trim().toLowerCase(), 'utf-8'), privateKey);
const code = signature.toString('base64url');

console.log('');
console.log(`Machine ID:       ${machineId.trim().toLowerCase()}`);
console.log(`Activation code:  ${code}`);
console.log('');
