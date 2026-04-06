import { EventEmitter } from 'events';
import { io, Socket } from 'socket.io-client';
import type { ConnectionState } from '../shared/types';

const GATEWAY_URL = 'https://gateway.onlycat.com';

class GatewayClient extends EventEmitter {
  private socket: Socket | null = null;
  private _connectionState: ConnectionState = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  connect(token: string): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this._connectionState = 'connecting';

    this.socket = io(GATEWAY_URL, {
      transports: ['websocket'],
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    this.socket.on('connect', () => {
      this._connectionState = 'connected';
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.emit('connected');
    });

    this.socket.on('connect_error', (error: Error) => {
      this._connectionState = 'disconnected';
      this.emit('connect_error', error);
    });

    this.socket.on('disconnect', () => {
      this._connectionState = 'disconnected';
      this.emit('disconnected');
    });

    this.socket.io.on('reconnect_attempt', () => {
      this._connectionState = 'reconnecting';
      this.emit('reconnecting');
    });

    this.socket.io.on('reconnect', () => {
      this._connectionState = 'connected';
      this.emit('connected');
    });

    // Forward live update events
    this.socket.on('userDeviceUpdate', (data: unknown) => this.emit('userDeviceUpdate', data));
    this.socket.on('userEventUpdate', (data: unknown) => this.emit('userEventUpdate', data));
    this.socket.on('deviceUpdate', (data: unknown) => this.emit('deviceUpdate', data));
    this.socket.on('eventUpdate', (data: unknown) => this.emit('eventUpdate', data));
    this.socket.on('userUpdate', (data: unknown) => this.emit('userUpdate', data));
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this._connectionState = 'disconnected';
  }

  async request(event: string, payload: object): Promise<unknown> {
    if (!this.socket || this._connectionState !== 'connected') {
      throw new Error('GatewayClient: not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`GatewayClient: request timeout for event "${event}"`));
      }, 30000);

      const disconnectHandler = () => {
        clearTimeout(timeout);
        reject(new Error('GatewayClient: disconnected during request'));
      };

      this.socket!.once('disconnect', disconnectHandler);

      this.socket!.emit(event, payload, (response: { code?: number; message?: string } & unknown) => {
        this.socket!.off('disconnect', disconnectHandler);
        clearTimeout(timeout);

        if (response && typeof response === 'object' && 'code' in response && response.code !== 200) {
          reject(response);
        } else {
          resolve(response);
        }
      });
    });
  }
}

export default new GatewayClient();
