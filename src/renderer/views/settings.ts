import { el, mount } from '../dom';
import { button, confirmDialog, errorBanner, errorMessage, loadingState, pageHeader } from '../components';
import type { StorageInfo, SnapshotInfo } from '../../shared/ipc';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatSnapshotDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function successBanner(message: string): HTMLElement {
  return el('div', { class: 'banner banner-success', role: 'status' }, [message]);
}

function locationPanel(info: StorageInfo, onChangeLocation: () => void, onOpenFolder: () => void): HTMLElement {
  const statusBadge = info.isOneDrive
    ? el('span', { class: 'badge badge-credit' }, ['\u2713 Backed up to OneDrive'])
    : el('span', { class: 'badge badge-due' }, ['\u26A0 Not in a synced folder']);

  const hint = info.isOneDrive
    ? el('p', { class: 'field-hint' }, [
        'Your data file is inside OneDrive, which keeps it continuously and automatically backed up in the cloud \u2014 there\u2019s nothing else you need to do.',
      ])
    : el('p', { class: 'field-hint' }, [
        info.oneDriveDetectedPath
          ? `OneDrive was found on this computer (${info.oneDriveDetectedPath}) but your data isn\u2019t stored there yet. Move it there so it\u2019s always backed up.`
          : 'OneDrive wasn\u2019t found on this computer. Choose a folder that\u2019s synced to the cloud (OneDrive, Google Drive, Dropbox) to keep your data backed up.',
      ]);

  return el('section', { class: 'panel' }, [
    el('div', { class: 'panel-header-row' }, [el('h2', {}, ['Data Location'])]),
    statusBadge,
    hint,
    el('div', { class: 'settings-path' }, [info.dbFilePath]),
    el('div', { class: 'form-actions' }, [
      button('Change Location', onChangeLocation, 'primary'),
      button('Open Folder', onOpenFolder, 'secondary'),
    ]),
  ]);
}

function snapshotsPanel(
  snapshots: SnapshotInfo[],
  onCreateNow: () => void,
  creating: boolean
): HTMLElement {
  const list =
    snapshots.length === 0
      ? el('div', { class: 'state-message state-empty' }, ['No snapshots yet \u2014 one is created automatically each month.'])
      : el(
          'ul',
          { class: 'snapshot-list' },
          snapshots.map((s) =>
            el('li', { class: 'snapshot-row' }, [
              el('span', {}, [formatSnapshotDate(s.createdAt)]),
              el('span', { class: 'cell-muted' }, [formatBytes(s.sizeBytes)]),
            ])
          )
        );

  return el('section', { class: 'panel' }, [
    el('div', { class: 'panel-header-row' }, [
      el('h2', {}, ['Monthly Snapshots']),
      button(creating ? 'Creating\u2026' : 'Create Snapshot Now', onCreateNow, 'secondary'),
    ]),
    el('p', { class: 'field-hint' }, [
      'A dated copy of your database is saved automatically once a month, in a Snapshots folder next to your data. This gives you a longer-lived checkpoint on top of your continuous OneDrive backup.',
    ]),
    list,
  ]);
}

function restorePanel(onRestore: () => void): HTMLElement {
  return el('section', { class: 'panel' }, [
    el('div', { class: 'panel-header-row' }, [el('h2', {}, ['Restore from Backup'])]),
    el('p', { class: 'field-hint' }, [
      'Replace your current data with an older snapshot. Your current data is automatically saved first, so this can always be undone by restoring again from that safety copy.',
    ]),
    el('div', { class: 'form-actions' }, [button('Choose Backup File\u2026', onRestore, 'danger')]),
  ]);
}

export async function renderSettings(container: HTMLElement): Promise<void> {
  mount(container, pageHeader('Settings / Backup'), loadingState('Loading storage info...'));

  let feedback: HTMLElement | null = null;
  let creatingSnapshot = false;

  async function load() {
    try {
      const info = await window.khata.getStorageInfo();
      renderPage(info);
    } catch (err) {
      mount(container, pageHeader('Settings / Backup'), errorBanner(errorMessage(err)));
    }
  }

  function renderPage(info: StorageInfo) {
    const parts: (HTMLElement | null)[] = [
      pageHeader('Settings / Backup'),
      feedback,
      locationPanel(info, handleChangeLocation, handleOpenFolder),
      snapshotsPanel(info.snapshots, handleCreateSnapshot, creatingSnapshot),
      restorePanel(handleRestore),
    ];
    mount(container, ...parts);
  }

  async function handleOpenFolder() {
    try {
      await window.khata.openStorageFolder();
    } catch (err) {
      feedback = errorBanner(errorMessage(err));
      await load();
    }
  }

  async function handleCreateSnapshot() {
    creatingSnapshot = true;
    feedback = null;
    const info = await window.khata.getStorageInfo();
    renderPage(info);
    try {
      await window.khata.createSnapshotNow();
      feedback = successBanner('Snapshot created.');
    } catch (err) {
      feedback = errorBanner(errorMessage(err));
    } finally {
      creatingSnapshot = false;
      await load();
    }
  }

  async function handleChangeLocation() {
    feedback = null;
    let choice;
    try {
      choice = await window.khata.chooseStorageFolder();
    } catch (err) {
      feedback = errorBanner(errorMessage(err));
      await load();
      return;
    }
    if (!choice) return; // dialog cancelled

    if (choice.hasExistingDatabase) {
      const confirmed = await confirmDialog(
        `A database already exists in this folder.\n\nOverwrite it with your current data? This cannot be undone.`,
        { confirmLabel: 'Overwrite', danger: true }
      );
      if (!confirmed) return;
    } else {
      const confirmed = await confirmDialog(
        `Move your data to:\n${choice.folderPath}\n\nThe app will restart to apply this change.`,
        { confirmLabel: 'Move & Restart' }
      );
      if (!confirmed) return;
    }

    try {
      // On success the main process exits the app before this promise can
      // resolve, so there's nothing further to do here in that case.
      await window.khata.confirmChangeStorageLocation({
        folderPath: choice.folderPath,
        overwrite: choice.hasExistingDatabase,
      });
    } catch (err) {
      feedback = errorBanner(errorMessage(err));
      await load();
    }
  }

  async function handleRestore() {
    feedback = null;
    let choice;
    try {
      choice = await window.khata.chooseRestoreFile();
    } catch (err) {
      feedback = errorBanner(errorMessage(err));
      await load();
      return;
    }
    if (!choice) return; // dialog cancelled

    if (!choice.isValid) {
      feedback = errorBanner('That file doesn\u2019t look like a khata database backup. Please choose a valid .db backup file.');
      await load();
      return;
    }

    const confirmed = await confirmDialog(
      `This will REPLACE all your current data with the backup:\n${choice.filePath}\n\n` +
        `Your current data will be saved first and can be restored back if needed. The app will restart to apply this.`,
      { confirmLabel: 'Restore', danger: true }
    );
    if (!confirmed) return;

    try {
      // On success the main process exits before this promise can
      // resolve, so there's nothing further to do here in that case.
      await window.khata.confirmRestore({ filePath: choice.filePath });
    } catch (err) {
      feedback = errorBanner(errorMessage(err));
      await load();
    }
  }

  await load();
}
