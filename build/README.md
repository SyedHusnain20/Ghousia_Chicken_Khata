# App icon

Place the Windows app icon here as:

```
icon.ico
```

Requirements:
- Must be a `.ico` file (not `.png`/`.jpg`) - it needs to bundle multiple
  resolutions (16, 32, 48, 256px) inside one file.
- Square source image, ideally 512x512 or larger, converted to `.ico` with
  a tool like icoconvert.com or redketchup.io/icon-converter.

Once `build/icon.ico` exists here:
- `npm run build` (via `scripts/copy-assets.js`) copies it into the
  compiled output so the running app's own window (title bar/taskbar)
  uses it - see `src/main/index.ts`.
- `npm run pack` (electron-builder) reads it directly for the installer,
  the Desktop/Start Menu shortcut, and the `.exe` file's own icon - see
  `package.json`'s `"build.win.icon"`.

Nothing else needs to change - both are already wired to read from this
one file.
