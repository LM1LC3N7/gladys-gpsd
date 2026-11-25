// -----------------------------------------------------------------------------
// gpsd reports as the official "gpsd JSON protocol" document describes them,
// and a scripted socket standing for a gpsd connection (net.createConnection).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export const VERSION = {
  class: 'VERSION',
  release: '3.25',
  rev: '3.25',
  proto_major: 3,
  proto_minor: 15,
};
export const PATH = '/dev/ttyACM0';

export const line = (obj) => `${JSON.stringify(obj)}\r\n`;

export const tpv = (extra = {}) => ({
  class: 'TPV',
  device: PATH,
  mode: 3,
  status: 2,
  time: '2026-11-25T10:00:00.000Z',
  lat: 48.858370123,
  lon: 2.294481456,
  altMSL: 35.42,
  altHAE: 80.1,
  speed: 5.0,
  track: 123.4,
  eph: 4.25,
  ...extra,
});

export const sky = (used = 7, seen = 11, extra = {}) => ({
  class: 'SKY',
  device: PATH,
  satellites: Array.from({ length: seen }, (_, i) => ({ PRN: i + 1, used: i < used, ss: 30 })),
  ...extra,
});

export const devices = (list = [{ path: PATH, activated: '2026-11-25T09:59:00.000Z' }]) => ({
  class: 'DEVICES',
  devices: list.map((d) => ({ class: 'DEVICE', driver: 'u-blox', ...d })),
});

/** A socket the test drives: `open()`, `send(obj | text)`, `fail(code)`, `writes`. */
export class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.destroyed = false;
  }

  setNoDelay() {}

  setKeepAlive() {}

  write(data) {
    if (!this.destroyed) this.writes.push(String(data));
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    queueMicrotask(() => this.emit('close'));
  }

  /** TCP connected, gpsd banner sent (unless `banner: false`). */
  open({ banner = true } = {}) {
    this.emit('connect');
    if (banner) this.send(VERSION);
  }

  send(objOrText) {
    if (this.destroyed) return;
    const text = typeof objOrText === 'string' ? objOrText : line(objOrText);
    this.emit('data', Buffer.from(text, 'utf8'));
  }

  fail(code = 'ECONNREFUSED') {
    if (this.destroyed) return;
    const err = Object.assign(new Error(code), { code });
    this.emit('error', err);
    this.destroy();
  }
}

/** A `connect` that records every socket it made. */
export function fakeConnect() {
  const sockets = [];
  const connect = (options) => {
    const socket = new FakeSocket();
    socket.options = options;
    sockets.push(socket);
    return socket;
  };
  connect.sockets = sockets;
  connect.last = () => sockets.at(-1);
  return connect;
}
