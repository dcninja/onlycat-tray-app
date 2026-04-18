import type { NotificationSettings } from '../../main/SettingsStore';

const videoOnly = document.getElementById('video-only') as HTMLInputElement;
const noSummary = document.getElementById('no-summary') as HTMLInputElement;
const clsChecks = document.querySelectorAll<HTMLInputElement>('.cls-check');
const dirChecks = document.querySelectorAll<HTMLInputElement>('.dir-check');
const actChecks = document.querySelectorAll<HTMLInputElement>('.act-check');
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;

// Load current settings
window.onlycat.getSettings!().then((settings: NotificationSettings) => {
  videoOnly.checked = settings.videoOnly;
  noSummary.checked = settings.showNoSummary;
  clsChecks.forEach(c => { c.checked = settings.classifications.includes(parseInt(c.dataset.cls ?? '0')); });
  dirChecks.forEach(c => { c.checked = settings.directions.includes(c.dataset.dir ?? ''); });
  actChecks.forEach(c => { c.checked = settings.actions.includes(c.dataset.act ?? ''); });
});

saveBtn.addEventListener('click', async () => {
  const settings: NotificationSettings = {
    videoOnly: videoOnly.checked,
    showNoSummary: noSummary.checked,
    classifications: Array.from(clsChecks).filter(c => c.checked).map(c => parseInt(c.dataset.cls ?? '0')),
    directions: Array.from(dirChecks).filter(c => c.checked).map(c => c.dataset.dir ?? ''),
    actions: Array.from(actChecks).filter(c => c.checked).map(c => c.dataset.act ?? ''),
  };
  await window.onlycat.saveSettings!(settings);
  window.onlycat.close!();
});

cancelBtn.addEventListener('click', () => window.onlycat.close!());
