import { BrowserWindow, nativeImage } from 'electron';
import * as path from 'path';
import { IPC_CHANNELS } from '../shared/ipcChannels';

const DIST_ROOT = path.join(__dirname, '../../..'); // → project root
const APP_ICON = nativeImage.createFromPath(path.join(DIST_ROOT, 'assets/icon-256.png'));

class WindowManager {
  private tokenDialog: BrowserWindow | null = null;
  private activityWindow: BrowserWindow | null = null;
  private videoWindow: BrowserWindow | null = null;

  openTokenDialog(): void {
    if (this.tokenDialog && !this.tokenDialog.isDestroyed()) {
      this.tokenDialog.focus();
      return;
    }

    this.tokenDialog = new BrowserWindow({
      width: 400,
      height: 260,
      resizable: false,
      title: 'OnlyCat — Sign In',
      autoHideMenuBar: true,
      icon: APP_ICON,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(DIST_ROOT, 'dist/renderer/renderer/token-dialog/preload.js'),
      },
    });

    this.tokenDialog.loadFile(
      path.join(DIST_ROOT, 'dist/renderer/renderer/token-dialog/index.html')
    );

    this.tokenDialog.on('closed', () => {
      this.tokenDialog = null;
    });
  }

  closeTokenDialog(): void {
    if (this.tokenDialog && !this.tokenDialog.isDestroyed()) {
      this.tokenDialog.close();
      this.tokenDialog = null;
    }
  }

  openActivityWindow(): void {
    if (this.activityWindow && !this.activityWindow.isDestroyed()) {
      this.activityWindow.focus();
      return;
    }

    this.activityWindow = new BrowserWindow({
      width: 600,
      height: 700,
      title: 'OnlyCat — Recent Activity',
      autoHideMenuBar: true,
      icon: APP_ICON,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(DIST_ROOT, 'dist/renderer/renderer/activity-window/preload.js'),
      },
    });

    this.activityWindow.loadFile(
      path.join(DIST_ROOT, 'dist/renderer/renderer/activity-window/index.html')
    );

    this.activityWindow.on('closed', () => {
      this.activityWindow = null;
    });
  }

  openVideoWindow(deviceId: string, eventId: number): void {
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      this.videoWindow.webContents.send(IPC_CHANNELS.VIDEO_OPEN, { deviceId, eventId });
      this.videoWindow.focus();
      return;
    }

    this.videoWindow = new BrowserWindow({
      width: 600,
      height: 900,
      title: 'OnlyCat — Event Video',
      autoHideMenuBar: true,
      icon: APP_ICON,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Start with a loading page
    this.videoWindow.loadURL('about:blank');

    this.videoWindow.webContents.on('did-finish-load', () => {
      this.videoWindow?.webContents.setZoomFactor(0.8);
    });

    this.videoWindow.on('closed', () => {
      this.videoWindow = null;
    });
  }

  getActivityWindow(): BrowserWindow | null {
    return this.activityWindow && !this.activityWindow.isDestroyed()
      ? this.activityWindow
      : null;
  }

  getVideoWindow(): BrowserWindow | null {
    return this.videoWindow && !this.videoWindow.isDestroyed()
      ? this.videoWindow
      : null;
  }

  getTokenDialog(): BrowserWindow | null {
    return this.tokenDialog && !this.tokenDialog.isDestroyed()
      ? this.tokenDialog
      : null;
  }
}

export default new WindowManager();
