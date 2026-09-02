# Admin Tools (YOU ONLY - never ship this folder to a client)

One-off scripts for fixing data directly in a client's `khata.db`, run by
you on your own machine (or the client's, if you have access) - never
part of the installed app itself.

## force-delete-party.js

Permanently deletes a supplier/customer/shopkeeper AND everything logged
against them (entries, bills, payments) - for the specific situation
where a party was entered by mistake and needs to be fully wiped out.

This intentionally bypasses the app's own safe "Delete" button, which
only allows deleting a party with zero history (protects the Daily
Ledger's accuracy for real transactions). Only use this script when the
whole party really was a mistake - not to erase real business history.

### Before running this

1. **Get a copy of the actual `khata.db` file** you need to fix - either
   from the client's OneDrive folder (if you have access to it), or ask
   them to send you the file.
2. **Close the app on the client's laptop first** if you're working on
   their live file directly, so nothing is writing to it at the same time.
3. **Back up the file** - just copy `khata.db` to `khata.db.backup`
   somewhere safe before touching anything.

### Running it

```
node admin-tools/force-delete-party.js "path\to\khata.db" supplier "Wrong Supplier Name"
```

This is a **dry run by default** - it only prints what would be deleted
(entry count, bill count, payment count) and changes nothing. Check that
the numbers look right, then add `--confirm` to actually delete:

```
node admin-tools/force-delete-party.js "path\to\khata.db" supplier "Wrong Supplier Name" --confirm
```

Run it once per party you need to remove (e.g. twice, for two mistaken
suppliers).

### If you hit a "wrong ABI version" / "NODE_MODULE_VERSION" error

This script runs under plain Node.js, but `better-sqlite3` in this
project may have last been rebuilt for *Electron's* Node version (e.g.
after running `npm run pack`), which plain Node can't load. Fix:

```
npm rebuild better-sqlite3
```

Then run the script. If you need to `npm run pack` again afterward,
electron-builder will automatically rebuild it back for Electron at that
point - you don't need to do anything extra.

### After running it

Replace the client's live `khata.db` with the fixed copy (app closed),
then have them reopen the app and confirm the supplier is gone and the
numbers look right.
