// -----------------------------------------------------------------------------
// The gpsd session on real TCP sockets (a local fake gpsd from the kit), with
// the virtual clock for its own timeouts.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { TIMEOUTS } from '../src/constants.js';
import { GpsdSession } from '../src/gpsd/session.js';
import { testClock } from './kit/clock.mjs';
import { tcpServer } from './kit/tcp.mjs';
import { VERSION, devices, line, sky, tpv } from './helpers/gpsd.js';
import { until } from './helpers/until.js';

/** A fake gpsd: banner, then the reports once watched; answers ?VERSION. */
async function fakeGpsd(t, { banner = line(VERSION) } = {}) {
  const gpsd = await tcpServer({
    onConnect: () => banner,
    onData: (chunk) => {
      const text = chunk.toString('latin1');
      let answer = '';
      if (text.includes('?WATCH=')) {
        answer += line(devices()) + line({ class: 'WATCH', enable: true, json: true });
        answer += line(tpv()) + line(sky());
      }
      if (text.includes('?VERSION;')) answer += line(VERSION);
      return answer || undefined;
    },
  });
  t.after(() => gpsd.close());
  return gpsd;
}

function open(t, port, extra = {}) {
  const clock = testClock();
  const seen = { messages: [], ends: [], watching: [] };
  const session = new GpsdSession({
    host: '127.0.0.1',
    port,
    monotonic: clock.monotonic,
    timers: clock.timers,
    onWatching: (v) => seen.watching.push(v),
    onMessage: (m) => seen.messages.push(m),
    onEnd: (r) => seen.ends.push(r),
    ...extra,
  });
  t.after(() => session.close());
  session.start();
  return { session, seen, clock };
}

test('banner, ?WATCH, reports: the real protocol exchange over TCP', async (t) => {
  const gpsd = await fakeGpsd(t);
  const { seen } = open(t, gpsd.port);
  await until(() => seen.messages.some((m) => m.class === 'SKY'), { what: 'the SKY report' });
  assert.equal(seen.watching[0].release, '3.25');
  assert.deepEqual(
    seen.messages.map((m) => m.class),
    ['DEVICES', 'WATCH', 'TPV', 'SKY'],
  );
  assert.equal(gpsd.text(), '?WATCH={"enable":true,"json":true};\n');
  assert.deepEqual(seen.ends, []);
});

test('the probe after a silence, over TCP', async (t) => {
  const gpsd = await fakeGpsd(t);
  const { seen, clock, session } = open(t, gpsd.port);
  await until(() => seen.messages.length === 4, { what: 'the reports' });
  await clock.advance(TIMEOUTS.PROBE_AFTER + 1);
  await until(() => gpsd.text().endsWith('?VERSION;\n'), { what: 'the probe' });
  await until(() => seen.messages.length === 5, { what: 'the answer' });
  assert.equal(session.phase, 'watching');
  await clock.advance(TIMEOUTS.PROBE_ANSWER + 1);
  assert.deepEqual(seen.ends, []);
});

test('refused port: "refused"', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  const { seen } = open(t, port);
  await until(() => seen.ends.length > 0, { what: 'the end' });
  assert.deepEqual(seen.ends, ['refused']);
});

test('a server that says nothing: not gpsd after the banner delay; nothing sent to it', async (t) => {
  const gpsd = await fakeGpsd(t, { banner: null });
  const { seen, clock, session } = open(t, gpsd.port);
  await until(() => session.phase === 'hello', { what: 'connected' });
  await clock.advance(TIMEOUTS.HELLO - 10);
  assert.deepEqual(seen.ends, []);
  await clock.advance(20);
  assert.deepEqual(seen.ends, ['not_gpsd']);
  await until(() => gpsd.open === 0, { what: 'the close' });
  assert.equal(gpsd.text(), '');
});

test('gpsd closing: "closed", once; close() ends without a callback', async (t) => {
  const gpsd = await fakeGpsd(t);
  const first = open(t, gpsd.port);
  await until(() => first.seen.watching.length === 1, { what: 'watching' });
  await gpsd.close();
  await until(() => first.seen.ends.length > 0, { what: 'the end' });
  assert.deepEqual(first.seen.ends, ['closed']);

  const other = await fakeGpsd(t);
  const second = open(t, other.port);
  await until(() => second.seen.watching.length === 1, { what: 'watching' });
  second.session.close();
  await until(() => other.open === 0, { what: 'the close' });
  assert.deepEqual(second.seen.ends, []);
  assert.equal(second.clock.pending, 0, 'its timer cleared');
});
