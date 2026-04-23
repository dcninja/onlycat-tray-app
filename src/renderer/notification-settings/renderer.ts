import type { NotificationSettings } from '../../main/SettingsStore';

const videoOnly = document.getElementById('video-only') as HTMLInputElement;
const noSummary = document.getElementById('no-summary') as HTMLInputElement;
const clsChecks = document.querySelectorAll<HTMLInputElement>('.cls-check');
const dirChecks = document.querySelectorAll<HTMLInputElement>('.dir-check');
const actChecks = document.querySelectorAll<HTMLInputElement>('.act-check');
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const tokenInput = document.getElementById('token-input') as HTMLInputElement;
const tokenSaveBtn = document.getElementById('token-save-btn') as HTMLButtonElement;
const tokenMsg = document.getElementById('token-msg') as HTMLParagraphElement;
const autoStartCheck = document.getElementById('auto-start') as HTMLInputElement;
const testNotificationBtn = document.getElementById('test-notification-btn') as HTMLButtonElement;

// Load current settings
window.onlycat.getSettings!().then((settings: NotificationSettings) => {
  videoOnly.checked = settings.videoOnly;
  noSummary.checked = settings.showNoSummary;
  clsChecks.forEach(c => { c.checked = settings.classifications.includes(parseInt(c.dataset.cls ?? '0')); });
  dirChecks.forEach(c => { c.checked = settings.directions.includes(c.dataset.dir ?? ''); });
  actChecks.forEach(c => { c.checked = settings.actions.includes(c.dataset.act ?? ''); });
});

// Load current token
(window.onlycat as any).getToken().then((token: string | null) => {
  if (token) tokenInput.value = token;
});

// Token update
tokenSaveBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) return;
  tokenMsg.hidden = true;
  tokenSaveBtn.disabled = true;
  tokenSaveBtn.textContent = 'Updating...';
  try {
    const result = await (window.onlycat as any).updateToken(token);
    if (result.success) {
      tokenMsg.textContent = 'Token updated and reconnected.';
      tokenMsg.className = 'msg success';
    } else {
      tokenMsg.textContent = result.error || 'Failed to connect with this token.';
      tokenMsg.className = 'msg error';
    }
  } catch {
    tokenMsg.textContent = 'Failed to update token.';
    tokenMsg.className = 'msg error';
  }
  tokenMsg.hidden = false;
  tokenSaveBtn.disabled = false;
  tokenSaveBtn.textContent = 'Update';
});

// Save notification settings
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

// Auto-start
(window.onlycat as any).getAutoStart().then((enabled: boolean) => {
  autoStartCheck.checked = enabled;
});
autoStartCheck.addEventListener('change', () => {
  (window.onlycat as any).setAutoStart(autoStartCheck.checked);
});

// Test notification
testNotificationBtn.addEventListener('click', async () => {
  testNotificationBtn.disabled = true;
  testNotificationBtn.textContent = 'Sending...';
  try {
    await (window.onlycat as any).testNotification();
  } catch { /* skip */ }
  testNotificationBtn.textContent = '🔔 Send Test Notification';
  testNotificationBtn.disabled = false;
});
