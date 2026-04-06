import { Notification, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { DeviceEvent } from '../shared/types';

type OnEventClick = (event: DeviceEvent) => void;

async function downloadToTemp(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const tmpPath = path.join(os.tmpdir(), `onlycat-thumb-${Date.now()}.jpg`);
    const request = net.request(url);
    const chunks: Buffer[] = [];

    request.on('response', (response) => {
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        try {
          fs.writeFileSync(tmpPath, Buffer.concat(chunks));
          resolve(tmpPath);
        } catch {
          resolve(undefined);
        }
      });
      response.on('error', () => resolve(undefined));
    });

    request.on('error', () => resolve(undefined));
    request.end();
  });
}

class NotificationManager {
  private onEventClick: OnEventClick = () => {};

  init(callbacks: { onEventClick: OnEventClick }): void {
    this.onEventClick = callbacks.onEventClick;
  }

  async notify(event: DeviceEvent, deviceName: string, catName?: string): Promise<void> {
    if (!Notification.isSupported()) {
      console.warn('NotificationManager: OS notifications not supported');
      return;
    }

    const time = event.createdAt
      ? new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    const title = `OnlyCat — ${deviceName}`;
    const who = catName ? `${catName} was detected` : 'Motion detected';
    const body = time ? `${who} at ${time}` : who;

    // Download thumbnail to temp file for notification icon
    let iconPath: string | undefined;
    if (event.thumbnailUrl) {
      iconPath = await downloadToTemp(event.thumbnailUrl);
    }

    const notification = new Notification({
      title,
      body,
      silent: false,
      ...(iconPath ? { icon: iconPath } : {}),
    });

    notification.on('click', () => {
      this.onEventClick(event);
      // Clean up temp file after click
      if (iconPath) try { fs.unlinkSync(iconPath); } catch {}
    });

    notification.on('close', () => {
      if (iconPath) try { fs.unlinkSync(iconPath); } catch {}
    });

    notification.show();
  }
}

export default new NotificationManager();
