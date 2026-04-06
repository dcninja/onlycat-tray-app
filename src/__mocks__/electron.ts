// Minimal Electron mock for Jest tests running in Node environment
const electron = {
  app: {
    getPath: (_name: string) => '/tmp/onlycat-test',
    on: jest.fn(),
    quit: jest.fn(),
  },
  ipcMain: {
    on: jest.fn(),
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
  ipcRenderer: {
    on: jest.fn(),
    send: jest.fn(),
    invoke: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: jest.fn(() => true),
    encryptString: jest.fn((str: string) => Buffer.from(str)),
    decryptString: jest.fn((buf: Buffer) => buf.toString()),
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadFile: jest.fn(),
    loadURL: jest.fn(),
    on: jest.fn(),
    webContents: { send: jest.fn() },
    close: jest.fn(),
    isDestroyed: jest.fn(() => false),
  })),
  Tray: jest.fn().mockImplementation(() => ({
    setContextMenu: jest.fn(),
    setToolTip: jest.fn(),
    setImage: jest.fn(),
    on: jest.fn(),
  })),
  Menu: {
    buildFromTemplate: jest.fn((template: unknown[]) => ({ template })),
  },
  Notification: jest.fn().mockImplementation(() => ({
    show: jest.fn(),
    on: jest.fn(),
  })),
  nativeImage: {
    createFromPath: jest.fn(() => ({})),
    createEmpty: jest.fn(() => ({})),
  },
};

module.exports = electron;
