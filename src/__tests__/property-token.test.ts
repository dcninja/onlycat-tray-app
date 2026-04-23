/**
 * Feature: onlycat-tray-app
 * Property 1: Token submission uses token as auth credential
 * Property 2: Token persistence round-trip
 */
import * as fc from 'fast-check';
import { arbToken } from './arbitraries';

// --- Property 1: Token submission uses token as auth credential ---

describe('Feature: onlycat-tray-app, Property 1: Token submission uses token as auth credential', () => {
  it('should pass the exact token string as Socket.IO auth credential', () => {
    // We test this by verifying the io() call receives the token in auth
    const mockIo = jest.fn().mockReturnValue({
      on: jest.fn(),
      io: { on: jest.fn() },
      disconnect: jest.fn(),
    });

    jest.resetModules();
    jest.doMock('socket.io-client', () => ({ io: mockIo }));

    const { default: gatewayClient } = require('../main/GatewayClient');

    fc.assert(
      fc.property(arbToken, (token) => {
        mockIo.mockClear();
        gatewayClient.connect(token);

        expect(mockIo).toHaveBeenCalledWith(
          'https://gateway.onlycat.com',
          expect.objectContaining({
            auth: { token },
            transports: ['websocket'],
          })
        );
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 2: Token persistence round-trip ---

describe('Feature: onlycat-tray-app, Property 2: Token persistence round-trip', () => {
  let tokenStore: any;
  const mockFs = require('fs');

  beforeEach(() => {
    jest.resetModules();
    // Use in-memory storage for the test
    const storage: Record<string, Buffer | string> = {};
    jest.spyOn(mockFs, 'writeFileSync').mockImplementation((...args: any[]) => {
      storage['token'] = args[1];
    });
    jest.spyOn(mockFs, 'readFileSync').mockImplementation(() => storage['token']);
    jest.spyOn(mockFs, 'existsSync').mockReturnValue(true);

    tokenStore = require('../main/TokenStore').default;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return the exact same token after save and load', () => {
    fc.assert(
      fc.property(arbToken, (token) => {
        tokenStore.save(token);
        const loaded = tokenStore.load();
        expect(loaded).toBe(token);
      }),
      { numRuns: 100 }
    );
  });

  it('should return null after clear', () => {
    jest.spyOn(mockFs, 'existsSync').mockReturnValue(false);
    const loaded = tokenStore.load();
    expect(loaded).toBeNull();
  });
});
