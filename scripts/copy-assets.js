// tsc only compiles .ts files, so anything else that needs to sit next to
// the compiled output (just the SQL schema now - the renderer is built and
// copied by Vite separately via `vite build`) has to be copied over
// manually. Kept as a plain script rather than a dependency so the build
// has one less moving part.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const filesToCopy = [
  ['src/main/db/schema.sql', 'dist/main/db/schema.sql'],
  // Optional: only copied if present, so the build doesn't break before an
  // icon has been added. See build/icon.ico's own comment for where this
  // is used - electron-builder reads it directly for the installer/
  // shortcut icon, and this copy is what lets the running app's window
  // (title bar/taskbar) use the same file - see src/main/index.ts.
  ['build/icon.ico', 'dist/main/icon.ico'],
];

for (const [from, to] of filesToCopy) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) {
    console.log(`skipped ${from} -> ${to} (not present)`);
    continue;
  }
  const dest = path.join(root, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`copied ${from} -> ${to}`);
}