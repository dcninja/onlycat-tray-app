const form = document.getElementById('token-form') as HTMLFormElement;
const input = document.getElementById('token-input') as HTMLInputElement;
const errorMsg = document.getElementById('error-msg') as HTMLParagraphElement;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

console.log('renderer loaded, window.onlycat:', typeof window.onlycat);

window.onlycat.onConnectError!((message: string) => {
  errorMsg.textContent = message || 'Authentication failed. Please check your token.';
  errorMsg.hidden = false;
  submitBtn.disabled = false;
  submitBtn.textContent = 'Connect';
  input.focus();
});

form.addEventListener('submit', (e: Event) => {
  e.preventDefault();
  const token = input.value.trim();
  if (!token) return;

  errorMsg.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Connecting...';

  window.onlycat.submitToken!(token);
});
