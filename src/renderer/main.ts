// Smoke test only: proves preload -> ipcMain -> better-sqlite3 -> back to
// the renderer works end-to-end before any real UI is built on top of it
// in Phase 3. window.khata is typed via global.d.ts, no `any` needed.

async function checkConnection(): Promise<void> {
  const statusEl = document.getElementById('status');
  if (!statusEl) return;

  try {
    const suppliers = await window.khata.listParties({ partyType: 'supplier' });
    const customers = await window.khata.listParties({ partyType: 'customer' });
    statusEl.textContent =
      `Connected. ${suppliers.length} supplier(s), ${customers.length} customer(s) in the database.`;
    statusEl.classList.add('ok');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    statusEl.textContent = 'Could not reach the local database: ' + message;
    statusEl.classList.add('err');
  }
}

checkConnection();