/**
 * fast-check arbitraries for generating random test data
 */
import * as fc from 'fast-check';
import type { Device, DeviceEvent } from '../shared/types';

export const arbDeviceId = fc.hexaString({ minLength: 8, maxLength: 16 }).map(s => `OC-${s}`);
export const arbCursorId = fc.uuid();
export const arbToken = fc.string({ minLength: 1, maxLength: 200 });

export const arbDevice: fc.Arbitrary<Device> = fc.record({
  deviceId: arbDeviceId,
  cursorId: arbCursorId,
  description: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  online: fc.option(fc.boolean(), { nil: undefined }),
  connectivity: fc.option(
    fc.record({
      connected: fc.boolean(),
      timestamp: fc.integer({ min: 1600000000000, max: 1900000000000 }),
    }),
    { nil: undefined }
  ),
});

export const arbDeviceEvent: fc.Arbitrary<DeviceEvent> = fc.record({
  globalId: fc.integer({ min: 1, max: 999999999 }),
  eventId: fc.integer({ min: 1, max: 99999 }),
  deviceId: arbDeviceId,
  timestamp: fc.option(
    fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }).map(d => d.toISOString()),
    { nil: undefined }
  ),
  accessToken: fc.option(fc.hexaString({ minLength: 16, maxLength: 32 }), { nil: undefined }),
  posterFrameIndex: fc.option(fc.integer({ min: 0, max: 500 }), { nil: undefined }),
  eventClassification: fc.option(fc.constantFrom(0, 1, 2, 3), { nil: undefined }),
  eventTriggerSource: fc.option(fc.constantFrom(1, 2, 3), { nil: undefined }),
  deviceName: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  catName: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  type: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  createdAt: fc.option(
    fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }).map(d => d.toISOString()),
    { nil: undefined }
  ),
  videoUrl: fc.option(fc.webUrl(), { nil: undefined }),
  thumbnailUrl: fc.option(fc.webUrl(), { nil: undefined }),
  summary: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  favourite: fc.option(fc.boolean(), { nil: undefined }),
});

/** Generate a non-empty array of DeviceEvents with unique globalIds */
export const arbUniqueEvents = (minLength = 1, maxLength = 50): fc.Arbitrary<DeviceEvent[]> =>
  fc.uniqueArray(arbDeviceEvent, {
    minLength,
    maxLength,
    selector: e => e.globalId,
  });

/** Generate a non-empty array of Devices with unique deviceIds */
export const arbUniqueDevices = (minLength = 1, maxLength = 10): fc.Arbitrary<Device[]> =>
  fc.uniqueArray(arbDevice, {
    minLength,
    maxLength,
    selector: d => d.deviceId,
  });
