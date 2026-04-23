/**
 * Feature: onlycat-tray-app
 * Property 3: Tray menu lists all devices with status
 * Property 4: New device create update adds to tray menu
 * Property 5: Device status update reflects in tray menu
 */
import * as fc from 'fast-check';
import { arbUniqueDevices, arbDevice } from './arbitraries';
import type { Device } from '../shared/types';

// We test buildMenuTemplate directly — it's a pure function of state
// Import TrayManager class and create a fresh instance for each test

function createTrayManager() {
  // Fresh require to get a new instance
  jest.resetModules();
  const TrayManagerModule = require('../main/TrayManager');
  // The module exports a singleton, but we can access the class via the prototype
  const manager = TrayManagerModule.default;
  // Init with no-op callbacks
  manager.init({
    onActivityClick: () => {},
    onSignOutClick: () => {},
    onUnacknowledgedClick: () => {},
    onTestNotification: () => {},
    onToggleVideoOnly: () => {},
    onCheckUpdate: () => {},
    onActivatePolicy: () => {},
    onCheckNotificationSettings: () => {},
    onToggleAutoStart: () => {},
    notifyOnVideoOnly: true,
    autoStartEnabled: false,
  });
  return manager;
}

function getMenuLabels(manager: any): string[] {
  const template = manager.buildMenuTemplate();
  return template
    .filter((item: any) => item.label)
    .map((item: any) => item.label as string);
}

// --- Property 3: Tray menu lists all devices with status ---

describe('Feature: onlycat-tray-app, Property 3: Tray menu lists all devices with status', () => {
  it('should contain a menu item for each device with name and status', () => {
    fc.assert(
      fc.property(arbUniqueDevices(1, 10), (devices) => {
        const manager = createTrayManager();
        manager.setConnectionState('connected');
        manager.setDevices(devices);

        const labels = getMenuLabels(manager);

        for (const device of devices) {
          const name = device.name ?? device.description ?? device.deviceId;
          const connected = device.connectivity?.connected ?? device.online;
          const status = connected ? '🟢' : '🔴';
          const expected = `${status} ${name}`;
          expect(labels).toContain(expected);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 4: New device create update adds to tray menu ---

describe('Feature: onlycat-tray-app, Property 4: New device create update adds to tray menu', () => {
  it('should contain the new device in addition to all previously listed devices', () => {
    fc.assert(
      fc.property(
        arbUniqueDevices(1, 5),
        arbDevice,
        (existingDevices, newDevice) => {
          // Ensure new device has a unique ID
          const usedIds = new Set(existingDevices.map(d => d.deviceId));
          if (usedIds.has(newDevice.deviceId)) return; // skip this case

          const manager = createTrayManager();
          manager.setConnectionState('connected');
          manager.setDevices(existingDevices);

          // Simulate adding the new device
          const allDevices = [...existingDevices, newDevice];
          manager.setDevices(allDevices);

          const labels = getMenuLabels(manager);

          // All devices (old + new) should be present
          for (const device of allDevices) {
            const name = device.name ?? device.description ?? device.deviceId;
            const connected = device.connectivity?.connected ?? device.online;
            const status = connected ? '🟢' : '🔴';
            expect(labels).toContain(`${status} ${name}`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 5: Device status update reflects in tray menu ---

describe('Feature: onlycat-tray-app, Property 5: Device status update reflects in tray menu', () => {
  it('should reflect the updated online/offline status after a device update', () => {
    fc.assert(
      fc.property(
        arbUniqueDevices(1, 5),
        fc.boolean(),
        (devices, newOnlineStatus) => {
          if (devices.length === 0) return;

          const manager = createTrayManager();
          manager.setConnectionState('connected');
          manager.setDevices(devices);

          // Pick the first device and update its status
          const targetDevice = devices[0];
          const updatedDevices = devices.map((d, i) =>
            i === 0
              ? { ...d, online: newOnlineStatus, connectivity: { connected: newOnlineStatus, timestamp: Date.now() } }
              : d
          );
          manager.setDevices(updatedDevices);

          const labels = getMenuLabels(manager);
          const name = targetDevice.name ?? targetDevice.description ?? targetDevice.deviceId;
          const expectedStatus = newOnlineStatus ? '🟢' : '🔴';
          expect(labels).toContain(`${expectedStatus} ${name}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});
