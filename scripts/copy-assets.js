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
];

for (const [from, to] of filesToCopy) {
  const src = path.join(root, from);
  const dest = path.join(root, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`copied ${from} -> ${to}`);
}