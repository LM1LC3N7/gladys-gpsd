// -----------------------------------------------------------------------------
// The app on a REAL moving clock (sped up 50 times) and a real local fake gpsd
// sending one TPV per simulated second: rounds are never sooner than the
// interval, on time, and the timers stay few. Everything is closed in t.after.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { GpsdApp } from '../src/app.js';
import { measurePeriod, realClock, spyOn } from './kit/clock.mjs';
import { tcpServer } from './kit/tcp.mjs';
import { VERSION, devices, line, tpv } from './helpers/gpsd.js';
import { until } from './helpers/until.js';

const SPEED = 50;
const PERIOD = 10_000;

test('real clock: rounds every publication interval, never sooner; timers bounded', async (t) => {
  let watched = false;
  const gpsd = await tcpServer({
    onConnect: () => line(VERSION),
    onData: (chunk) => {
      if (chunk.toString('latin1').includes('?WATCH=')) {
        watched = true;
        return line(devices());
      }
      return undefined;
    },
  });
  const clock = realClock({ speed: SPEED });
  const gladys = createFakeGladys({
    selector: 'gpsd',
    config: { host: `127.0.0.1:${gpsd.port}`, publish_interval: String(PERIOD / 1000) },
  });
  const app = new GpsdApp({ gladys, monotonic: clock.monotonic, timers: clock.timers });
  let lat = 40;
  const feed = setInterval(() => {
    if (watched) gpsd.push(line(tpv({ lat: (lat += 0.01) })));
  }, 1000 / SPEED);
  t.after(async () => {
    clearInterval(feed);
    await app.stop();
    clock.close();
    await gpsd.close();
  });
  const spy = spyOn(app, 'publishRound', clock);
  app.startFromGladys();
  await until(() => watched, { what: 'the ?WATCH request' });
  const gaps = await measurePeriod(spy, { count: 4, period: PERIOD });
  assert.equal(gaps.length, 3);
  await until(() => gladys.fake.states.length > 0, { what: 'a state' });
  assert.ok(clock.timersSet < 40, `${clock.timersSet} timers`);
  await app.stop();
  const set = clock.timersSet;
  await clock.sleep(2 * PERIOD);
  assert.equal(clock.timersSet, set, 'no timer after stop()');
});
