import { contextBridge, ipcRenderer } from 'electron';

// Inline channel names to avoid module resolution issues in sandboxed preload
const AUTH_SUBMIT_TOKEN = 'auth:submit-token';
const AUTH_CONNECT_ERROR = 'auth:connect-error';

contextBridge.exposeInMainWorld('onlycat', {
  submitToken: (token: string) =>
    ipcRenderer.send(AUTH_SUBMIT_TOKEN, { token }),
  onConnectError: (cb: (message: string) => void) => {
    ipcRenderer.on(AUTH_CONNECT_ERROR, (_event, payload: { message: string }) => {
      cb(payload.message);
    });
  },
});
