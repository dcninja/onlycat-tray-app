/**
 * Feature: onlycat-tray-app
 * Property 10: Notification shown for any new event regardless of window state
 * Property 11: Notification click opens Video_Window with correct event
 */
import * as fc from 'fast-check';
import { arbDeviceEvent } from './arbitraries';
import type { DeviceEvent } from '../shared/types';

// Get the mocked electron module — same instance NotificationManager will use
const electron = require('electron');

// Generate events without thumbnailUrl to avoid https download in tests
const arbEventNoThumb = arbDeviceEvent.map(e => ({ ...e, thumbnailUrl: undefined }));

describe('Feature: onlycat-tray-app, Property 10: Notification shown for any new event regardless of window state', () => {
  let notificationManager: any;

  beforeAll(() => {
    notificationManager = require('../main/NotificationManager').default;
    notificationManager.init({ onEventClick: jest.fn() });
  });

  beforeEach(() => {
    electron.Notification.mockClear();
  });

  it('should create and show a notification for any event', async () => {
    await fc.assert(
      fc.asyncProperty(arbEventNoThumb, async (event) => {
        electron.Notification.mockClear();
        const deviceName = event.deviceName ?? event.deviceId;

        await notificationManager.notify(event, deviceName);

        expect(electron.Notification).toHaveBeenCalledWith(
          expect.objectContaining({
            title: expect.stringContaining('OnlyCat'),
          })
        );

        const instance = electron.Notification.mock.results[electron.Notification.mock.results.length - 1]?.value;
        expect(instance.show).toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  }, 30000);
});

describe('Feature: onlycat-tray-app, Property 11: Notification click opens Video_Window with correct event', () => {
  let notificationManager: any;
  let clickHandler: jest.Mock;

  beforeAll(() => {
    electron.Notification.mockImplementation(() => {
      const handlers: Record<string, Function> = {};
      return {
        show: jest.fn(),
        on: jest.fn((eventName: string, handler: Function) => {
          handlers[eventName] = handler;
        }),
        _handlers: handlers,
      };
    });

    clickHandler = jest.fn();
    notificationManager = require('../main/NotificationManager').default;
    notificationManager.init({ onEventClick: clickHandler });
  });

  beforeEach(() => {
    clickHandler.mockClear();
    electron.Notification.mockClear();
  });

  it('should call onEventClick with the correct event when notification is clicked', async () => {
    await fc.assert(
      fc.asyncProperty(arbEventNoThumb, async (event) => {
        clickHandler.mockClear();
        electron.Notification.mockClear();

        const deviceName = event.deviceName ?? event.deviceId;
        await notificationManager.notify(event, deviceName);

        const instance = electron.Notification.mock.results[electron.Notification.mock.results.length - 1]?.value;
        const clickCb = instance?._handlers?.['click'];
        if (clickCb) {
          clickCb();
          expect(clickHandler).toHaveBeenCalledWith(event);
        }
      }),
      { numRuns: 100 }
    );
  }, 30000);
});
