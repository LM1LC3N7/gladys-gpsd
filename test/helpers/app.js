// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted gpsd socket and the
// virtual clock of the kit (it moves at every read). Every timer the app asks
// for is checked: a finite delay, never negative, never above 6 hours.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { GpsdApp } from '../../src/app.js';
import { registerHandlers } from '../../src/handlers.js';
import { buildDevice, receiverKey } from '../../src/devices.js';
import { settle, testClock } from '../kit/clock.mjs';
import { fakeConnect } from './gpsd.js';

export const SELECTOR = 'gpsd';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOST = '192.168.1.40';
export const CONFIG = { host: HOST, publish_interval: '60', precision: '4' };
export const KEY = receiverKey(HOST, 2947);
export const F = (key) => `ext:${SELECTOR}:receiver:${KEY}:${key}`;

/** A logger that keeps every line (to look for a leaked coordinate). */
export function memoryLogger() {
  const lines = [];
  const keep =
    (level) =>
    (...args) =>
      lines.push(
        `${level} ${args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')}`,
      );
  return {
    lines,
    info: keep('info'),
    warn: keep('warn'),
    error: keep('error'),
    debug: keep('debug'),
  };
}

export async function setup({ config = CONFIG, connected = true, devices = [] } = {}) {
  const clock = testClock();
  const badTimers = [];
  const timers = {
    setTimeout: (fn, ms) => {
      if (!Number.isFinite(ms) || ms < 0 || ms > 6 * 3600_000) badTimers.push(ms);
      return clock.timers.setTimeout(fn, ms);
    },
    clearTimeout: (h) => clock.timers.clearTimeout(h),
  };
  const gladys = createFakeGladys({ selector: SELECTOR, config: { ...config }, devices });
  const logger = memoryLogger();
  const connect = fakeConnect();
  const app = new GpsdApp({ gladys, logger, monotonic: clock.monotonic, timers, connect });
  registerHandlers(gladys, app, logger);
  if (connected) await gladys.connect();
  await settle();
  return { clock, gladys, app, logger, connect, badTimers };
}

/** Lets the app react (I/O-free: promise turns only). */
export const tick = () => settle(10);

/** The states Gladys received for a feature key. */
export const statesOf = (gladys, key) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === F(key));

export const lastStatus = (gladys) => gladys.fake.connectionStatus;

export { buildDevice };
