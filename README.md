# Ghousia Chicken Khata

A local, offline desktop **khata** (ledger) app for a chicken shop — tracks
what suppliers are owed, what customers owe, day-to-day sales, and bills,
without needing the internet or a server.

Built by **R&R Digital Solutions** as an Electron desktop app for Windows.

## What it does

- **Suppliers, Customers & Shopkeepers** — three independent ledgers with the
  same behaviour: log purchases/sales as they happen, record payments (cash
  or online), and watch a running due balance (or credit, if it goes
  negative).
- **Entries** — each purchase/sale line has an item, weight (kg), rate/kg,
  and an auto-calculated total, dated whenever it actually happened (not just
  "today"). Unbilled entries can be edited or deleted at any time to fix a
  mistake.
- **Payments** — recorded standalone against a party's balance, or at the
  moment a bill is generated. Unbilled payments can likewise be edited or
  deleted — the party's due is adjusted to match.
- **Bill generation** — sweeps a party's unbilled entries (and any payment
  taken at the same time) into a numbered, printable bill showing previous
  due, this bill's subtotal, and the new balance. A generated bill is a fixed
  record: its entries/payments lock and can no longer be edited directly.
- **Restore bill** — undoes a generated bill: its entries and payments go
  back to being unbilled with their exact original dates and amounts, and
  the bill itself is deleted, so a mistake can be fixed and a corrected bill
  generated afterwards. The party's due is unaffected either way.
- **Share a bill** — print it (styled for an 80mm receipt printer) or share
  it as an image over WhatsApp directly from the bill screen.
- **Daily Ledger** — one page per business date: today's sale income, extra
  expenses, informal "Udhar" credit sales (name + amount, as many as
  needed), and an Items Left breakdown (unsold live chicken / chicken meat /
  liver, each with weight, rate, and total). Supplier purchases and customer
  sales are never re-entered here — they're pulled in live from the same
  entries logged on each party's profile, so there's exactly one source of
  truth.
- **Reports** — a PDF "customers closing" report across all customers, and
  per-bill image sharing, both generated locally.
- **Start-up password** — the app asks for a password every time it's freshly
  opened (after being closed, or after the laptop is turned on), but not
  after minimizing or switching windows. Changeable from Settings. See
  [Data & security](#data--security) below.
- **OneDrive-aware storage & backups** — the database lives in a folder the
  shopkeeper picks (typically their OneDrive folder, auto-detected), with
  automatic monthly snapshots kept alongside it.

## Tech stack

- **Electron** — desktop shell (main + renderer processes)
- **TypeScript** everywhere (strict, two separate compiler projects for
  main and renderer — see `tsconfig.json` / `tsconfig.renderer.json`)
- **better-sqlite3** — the entire database is a single local `khata.db`
  SQLite file (schema in `src/main/db/schema.sql`); no server, no ORM
- **Vite** — bundles the renderer
- Renderer UI is hand-rolled (`src/renderer/dom.ts`'s `el()` helper + a
  small hash router) — no framework, kept deliberately simple for the size
  of the app
- **electron-builder** — packages a Windows NSIS installer

## Project structure

```
src/
  main/                    Electron main process (Node/SQLite side)
    db/                    schema.sql + database open/init
    services/              business logic: parties, entries, payments,
                            bills, daily ledger — all pure functions over
                            a better-sqlite3 Database instance
    security/              app-lock (start-up password) + the IPC guard
                            that enforces it
    reports/               PDF closing report, WhatsApp bill image
    storage/                storage-folder + OneDrive detection
    backup/                 monthly snapshot service
    *IpcHandlers.ts         wires each service to an IPC channel
  preload/                 contextBridge — the only surface the renderer
                            can call into the main process through
  shared/ipc.ts            IPC channel names + the request/response
                            contract shared by main, preload and renderer
  renderer/                UI: views/ (one file per screen), components,
                            router, formatting helpers
test/                      standalone ts-node scripts exercising the real
                            service layer against an in-memory database
                            (see Testing below)
admin-tools/               scripts run by the developer against a client's
                            khata.db directly — never shipped in the app
                            (see admin-tools/README.md)
```

## Getting started

```bash
npm install
npm run dev        # Vite dev server + Electron, with hot reload
```

```bash
npm run build      # compile main + bundle renderer into dist/
npm start           # build, then launch Electron against dist/
npm run pack        # build, then produce a Windows installer in release/
```

A GitHub Actions workflow (`.github/workflows/build-windows.yml`) builds the
installer automatically on every push to `main`, and can also be triggered
manually from the Actions tab — useful since `better-sqlite3`'s native
module needs a Windows build environment that isn't always on hand locally.

## Testing

There's no Electron UI test harness; instead, each feature's business logic
is exercised directly against a real (in-memory) database:

```bash
npm run test:scenario       # end-to-end supplier/customer/bill scenario
npm run test:restore-bill   # bill generation + restore
npm run test:payment-edit   # edit/delete on unbilled payments
npm run test:app-lock       # password setup/unlock/change, lockout
npm run test:ipc-lock       # every IPC channel refuses while locked
```

Each script prints `PASS`/`FAIL` per assertion and exits non-zero if
anything fails.

## Data & security

- All data lives in **one file**, `khata.db`, in a folder chosen on first
  run (Settings lets this be changed later). Nothing is sent anywhere over
  the network — the app works fully offline.
- If OneDrive is signed in on the laptop, its folder is offered by default
  so the ledger backs itself up automatically; this is a convenience, not a
  requirement.
- A monthly snapshot (`Snapshots/khata-YYYY-MM.db`) is kept alongside the
  live database, with the last 12 kept automatically.
- The **start-up password** is stored only as a salted hash (`app-lock.json`)
  in the app's own local data folder — never inside `khata.db`, so it's
  never synced to OneDrive and a restored backup can never roll it back.
  It's an app-level lock, not disk encryption: `khata.db` itself remains a
  normal, unencrypted file. If the owner forgets the password, see
  `admin-tools/README.md` for the reset procedure (deleting one local file;
  their ledger data is untouched).

## For developers extending this app

- Business rules belong in `src/main/services/*` as plain functions over a
  `Database` instance — this is what the `test/*.ts` scripts exercise
  directly, so new logic should be testable the same way.
- A new IPC channel needs three additions kept in sync: `IpcChannels` and
  its request/response types in `src/shared/ipc.ts`, the `invoke` call in
  `src/preload/index.ts`, and the handler in the matching
  `src/main/*IpcHandlers.ts` (use `guardedHandle`, not `ipcMain.handle`
  directly, unless the channel must work before the app is unlocked).
- `admin-tools/` scripts talk to a `khata.db` file directly with plain
  Node + better-sqlite3, bypassing the app's IPC/service layer entirely —
  they're for fixing a client's data by hand, not a pattern to extend the
  app's own features with.
