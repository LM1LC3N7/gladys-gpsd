// -----------------------------------------------------------------------------
// The app end to end on the fake Gladys, a scripted gpsd socket and a virtual
// clock: connection, pace, freshness, privacy, retries, statuses.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, INTERVALS, LIMITS, TIMEOUTS } from '../src/constants.js';
import { buildDevice } from '../src/devices.js';
import { readSky, readTpv } from '../src/gpsd/parse.js';
import { buildStates } from '../src/report.js';
import { PATH, VERSION, devices, sky, tpv } from './helpers/gpsd.js';
import { CONFIG, F, MINUTE, SECOND, lastStatus, setup, statesOf, tick } from './helpers/app.js';

/** Connected and watching: the banner read, the receiver listed. */
async function watching(ctx) {
  const socket = ctx.connect.last();
  socket.open();
  socket.send(devices());
  await tick();
  return socket;
}

const valueOf = (gladys, key) => gladys.fake.lastState(F(key));

test('connects to gpsd, asks JSON reports only, publishes the device', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  assert.equal(ctx.connect.sockets.length, 1);
  assert.deepEqual(ctx.connect.last().options, { host: '192.168.1.40', port: 2947 });
  assert.equal(lastStatus(ctx.gladys).connected, false, 'connecting');
  const socket = await watching(ctx);
  assert.deepEqual(socket.writes, ['?WATCH={"enable":true,"json":true};\n']);
  assert.equal(lastStatus(ctx.gladys).connected, true);
  assert.match(lastStatus(ctx.gladys).message.en, /gpsd 3\.25: waiting/);
  const [device] = ctx.gladys.fake.discoveredDevices;
  assert.equal(device.external_id, F('').slice(0, -1));
  assert.ok(device.features.every((f) => f.read_only === true));
  assert.deepEqual(ctx.badTimers, []);
});

test('the first fix is published at once, rounded; unknown values stay unknown', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv());
  socket.send(sky(7, 11));
  await ctx.clock.advance(0);
  await tick();
  assert.equal(valueOf(ctx.gladys, FEATURES.LATITUDE), 48.8584);
  assert.equal(valueOf(ctx.gladys, FEATURES.LONGITUDE), 2.2945);
  assert.equal(valueOf(ctx.gladys, FEATURES.SPEED), 18);
  assert.equal(valueOf(ctx.gladys, FEATURES.ALTITUDE), 35, 'altMSL, to the metre with 4 decimals');
  assert.equal(valueOf(ctx.gladys, FEATURES.COURSE), 123);
  assert.equal(valueOf(ctx.gladys, FEATURES.HORIZONTAL_ERROR), 4.3);
  assert.equal(valueOf(ctx.gladys, FEATURES.FIX_MODE), 3);
  assert.equal(statesOf(ctx.gladys, FEATURES.FIX).at(-1).text, '3D DGPS');
  assert.equal(valueOf(ctx.gladys, FEATURES.SATELLITES_USED), 7);
  assert.equal(valueOf(ctx.gladys, FEATURES.SATELLITES_SEEN), 11);
  await ctx.clock.advance(INTERVALS.STATUS_MIN_GAP_MS);
  assert.match(lastStatus(ctx.gladys).message.en, /position fixed/);
});

test('a TPV without speed, altitude nor error publishes none of them (never 0)', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv({ mode: 2, speed: undefined, altMSL: undefined, eph: undefined, track: 90 }));
  await ctx.clock.advance(0);
  await tick();
  assert.equal(valueOf(ctx.gladys, FEATURES.LATITUDE), 48.8584);
  for (const key of [
    FEATURES.SPEED,
    FEATURES.ALTITUDE,
    FEATURES.HORIZONTAL_ERROR,
    FEATURES.COURSE,
  ]) {
    assert.equal(statesOf(ctx.gladys, key).length, 0, key);
  }
  assert.equal(statesOf(ctx.gladys, FEATURES.FIX).at(-1).text, '2D DGPS');
});

test('no fix: the mode is published, never a position; mode 0 publishes nothing', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv({ mode: 0 }));
  await ctx.clock.advance(0);
  await tick();
  assert.equal(ctx.gladys.fake.states.length, 0, 'mode 0: nothing');
  socket.send(tpv({ mode: 1, status: undefined }));
  await ctx.clock.advance(0);
  await tick();
  assert.equal(valueOf(ctx.gladys, FEATURES.FIX_MODE), 1);
  assert.equal(statesOf(ctx.gladys, FEATURES.FIX).at(-1).text, 'no fix');
  assert.equal(statesOf(ctx.gladys, FEATURES.LATITUDE).length, 0);
  assert.equal(statesOf(ctx.gladys, FEATURES.SPEED).length, 0);
  await ctx.clock.advance(INTERVALS.STATUS_MIN_GAP_MS);
  assert.match(lastStatus(ctx.gladys).message.en, /no fix yet/);
});

test('pace: one report per second, at most one round per interval', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const rounds = [];
  const original = ctx.gladys.publishChangedStates.bind(ctx.gladys);
  t.mock.method(ctx.gladys, 'publishChangedStates', async (states, options) => {
    rounds.push(ctx.clock.elapsed);
    assert.equal(options.heartbeat, INTERVALS.HEARTBEAT_MS);
    return original(states, options);
  });
  const socket = await watching(ctx);
  for (let s = 0; s < 185; s += 1) {
    socket.send(tpv({ lat: 48 + s / 1000 }));
    await ctx.clock.advance(SECOND);
  }
  await tick();
  assert.equal(rounds.length, 4, `rounds at ${rounds.map(Math.round)}`);
  for (let i = 1; i < rounds.length; i += 1) {
    assert.ok(rounds[i] - rounds[i - 1] >= MINUTE, 'never sooner than the interval');
    assert.ok(rounds[i] - rounds[i - 1] < MINUTE + 2 * SECOND, 'on time');
  }
  // The newest report of the round is the one published.
  assert.equal(
    valueOf(ctx.gladys, FEATURES.LATITUDE),
    48.179,
    'the report of 179 s, newest at 180 s',
  );
  assert.deepEqual(ctx.badTimers, []);
});

test('nothing old is published: a quiet receiver publishes nothing more', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv());
  await ctx.clock.advance(0);
  await tick();
  const count = ctx.gladys.fake.states.length;
  // gpsd keeps answering the probes, the receiver says nothing.
  for (let i = 0; i < 10; i += 1) {
    await ctx.clock.advance(TIMEOUTS.PROBE_AFTER);
    socket.send(VERSION);
  }
  assert.equal(ctx.gladys.fake.states.length, count);
});

test('the reports kept are dropped when the connection ends', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv());
  await ctx.clock.advance(0);
  socket.send(tpv({ lat: 47 }));
  socket.fail('ECONNRESET');
  await tick();
  const count = ctx.gladys.fake.states.length;
  await ctx.clock.advance(2 * MINUTE);
  await tick();
  assert.equal(ctx.gladys.fake.states.length, count, 'the TPV before the end is not published');
  assert.notEqual(valueOf(ctx.gladys, FEATURES.LATITUDE), 47);
});

/** publishChangedStates held until `release()`: a publication in flight. */
function holdPublications(t, ctx) {
  const original = ctx.gladys.publishChangedStates.bind(ctx.gladys);
  const held = [];
  t.mock.method(ctx.gladys, 'publishChangedStates', (...args) => {
    return new Promise((resolve, reject) => {
      held.push(() => original(...args).then(resolve, reject));
    });
  });
  return {
    held,
    release: async () => {
      while (held.length) await held.shift()();
    },
  };
}

test('a report received during a publication in flight is dropped if the connection ends', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  const gate = holdPublications(t, ctx);
  socket.send(tpv({ lat: 1 }));
  await ctx.clock.advance(0);
  assert.equal(gate.held.length, 1, 'in flight');
  socket.send(tpv({ lat: 47 }));
  socket.fail('ECONNRESET');
  await tick();
  await gate.release();
  // The next connection reports satellites only, at first.
  await ctx.clock.advance(INTERVALS.RETRY_MIN_MS);
  const next = ctx.connect.last();
  assert.notEqual(next, socket);
  next.open();
  next.send(sky(5, 9));
  await ctx.clock.advance(2 * MINUTE);
  await gate.release();
  await tick();
  assert.equal(valueOf(ctx.gladys, FEATURES.SATELLITES_USED), 5);
  assert.equal(valueOf(ctx.gladys, FEATURES.LATITUDE), 1);
  assert.equal(
    statesOf(ctx.gladys, FEATURES.LATITUDE).length,
    1,
    'the report before the end never',
  );
});

test('a report of the old gpsd is never published on the device of the new one', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  const gate = holdPublications(t, ctx);
  socket.send(tpv({ lat: 1 }));
  await ctx.clock.advance(0);
  socket.send(tpv({ lat: 47 }));
  await ctx.gladys.fake.configUpdated({ ...CONFIG, host: 'gps.lan' });
  await tick();
  await gate.release();
  const next = ctx.connect.last();
  next.open();
  next.send(sky(5, 9));
  await ctx.clock.advance(2 * MINUTE);
  await gate.release();
  await tick();
  assert.ok(
    ctx.gladys.fake.states.some((s) => s.state === 5),
    'the new gpsd is published',
  );
  const lat47 = ctx.gladys.fake.states.filter((s) => s.state === 47);
  assert.deepEqual(lat47, [], 'nothing of the old gpsd after the change');
});

test('a lost connection is tried again, doubling from 5 s, reset after a stable one', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  ctx.connect.last().fail('ECONNREFUSED');
  await tick();
  assert.match(lastStatus(ctx.gladys).message.en, /refused the connection.*5 s/);
  const delays = [];
  for (let i = 0; i < 4; i += 1) {
    const before = ctx.connect.sockets.length;
    const start = ctx.clock.elapsed;
    while (ctx.connect.sockets.length === before) await ctx.clock.advance(SECOND);
    delays.push(Math.round((ctx.clock.elapsed - start) / SECOND));
    ctx.connect.last().fail('ECONNREFUSED');
    await tick();
  }
  assert.deepEqual(delays, [5, 10, 20, 40]);
  // A connection that lived a minute: the next retry is 5 s again.
  await ctx.clock.advance(80 * SECOND);
  const socket = ctx.connect.last();
  socket.open();
  await tick();
  for (let i = 0; i < 70; i += 1) {
    socket.send(tpv());
    await ctx.clock.advance(SECOND);
  }
  socket.fail('ECONNRESET');
  await tick();
  assert.match(lastStatus(ctx.gladys).message.en, /closed the connection.*5 s/);
  assert.deepEqual(ctx.badTimers, []);
});

test('backoff stays bounded at 5 minutes', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  for (let i = 0; i < 12; i += 1) {
    const before = ctx.connect.sockets.length;
    ctx.connect.last().fail('EHOSTUNREACH');
    await tick();
    while (ctx.connect.sockets.length === before) await ctx.clock.advance(10 * SECOND);
  }
  ctx.connect.last().fail('EHOSTUNREACH');
  await tick();
  assert.match(lastStatus(ctx.gladys).message.en, /cannot be reached\. Next try in 300 s/);
  assert.deepEqual(ctx.badTimers, []);
});

/** Advances until the app opens a new connection; returns it. */
async function nextSocket(ctx) {
  const before = ctx.connect.sockets.length;
  for (let i = 0; i < 400 && ctx.connect.sockets.length === before; i += 1) {
    await ctx.clock.advance(SECOND);
  }
  assert.ok(ctx.connect.sockets.length > before, 'a new connection');
  return ctx.connect.last();
}

test('not gpsd: another first line, or no banner within 5 s; protocol 2 refused', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  let socket = ctx.connect.last();
  socket.emit('connect');
  socket.send('HTTP/1.1 400 Bad Request\r\n');
  await tick();
  assert.equal(socket.destroyed, true);
  assert.match(lastStatus(ctx.gladys).message.en, /does not speak the gpsd protocol/);
  assert.deepEqual(socket.writes, [], 'nothing sent to something that is not gpsd');

  socket = await nextSocket(ctx);
  socket.open({ banner: false });
  await ctx.clock.advance(TIMEOUTS.HELLO - 100);
  assert.equal(socket.destroyed, false);
  await ctx.clock.advance(200);
  await tick();
  assert.equal(socket.destroyed, true);

  socket = await nextSocket(ctx);
  socket.emit('connect');
  socket.send({ ...VERSION, proto_major: 2 });
  await tick();
  assert.equal(socket.destroyed, true);
  assert.match(lastStatus(ctx.gladys).message.en, /another version of its protocol/);
});

test('connection timeout after 10 s', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = ctx.connect.last();
  await ctx.clock.advance(TIMEOUTS.CONNECT - 100);
  assert.equal(socket.destroyed, false);
  await ctx.clock.advance(200);
  await tick();
  assert.equal(socket.destroyed, true);
  assert.match(lastStatus(ctx.gladys).message.en, /no answer/);
});

test('a silent connection is asked its version, closed when it does not answer', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv());
  await ctx.clock.advance(TIMEOUTS.PROBE_AFTER - SECOND);
  assert.equal(socket.writes.length, 1);
  await ctx.clock.advance(2 * SECOND);
  assert.equal(socket.writes[1], '?VERSION;\n');
  assert.match(lastStatus(ctx.gladys).message.en, /no report for a minute/);
  socket.send(VERSION);
  await ctx.clock.advance(TIMEOUTS.PROBE_ANSWER + SECOND);
  assert.equal(socket.destroyed, false, 'answered: kept');
  await ctx.clock.advance(TIMEOUTS.PROBE_AFTER + TIMEOUTS.PROBE_ANSWER + SECOND);
  await tick();
  assert.equal(socket.destroyed, true, 'no answer: closed');
  assert.ok(
    ctx.gladys.fake.connectionStatuses.some((s) => /stopped answering/.test(s.message?.en)),
  );
});

test('a flood closes the connection; an oversized line is dropped, the next ones read', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  let socket = await watching(ctx);
  socket.send(`{"class":"TPV","pad":"${'x'.repeat(20_000)}"}\r\n`);
  socket.send(tpv());
  await ctx.clock.advance(0);
  await tick();
  assert.equal(valueOf(ctx.gladys, FEATURES.LATITUDE), 48.8584);
  assert.equal(socket.destroyed, false);
  socket.send(`${'y'.repeat(300 * 1024)}`);
  await tick();
  assert.equal(socket.destroyed, true);
  assert.match(lastStatus(ctx.gladys).message.en, /far more data/);
  await ctx.clock.advance(INTERVALS.RETRY_MIN_MS);
  socket = ctx.connect.last();
  assert.equal(socket.destroyed, false);
});

test('an unexpected line or object stops nothing', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  for (const bad of [
    'garbage\r\n',
    '[1,2]\r\n',
    '{"class":42}\r\n',
    '{"class":"TPV","mode":"3","lat":"48"}\r\n',
    '{"class":"TPV","mode":3,"lat":91,"lon":2}\r\n',
    '{"class":"SKY","satellites":"many"}\r\n',
    '{"class":"ERROR","message":"Unrecognized request \\u001b[31m"}\r\n',
    '{"class":"__proto__","__proto__":{"polluted":1}}\r\n',
  ]) {
    socket.send(bad);
  }
  socket.send(tpv());
  await ctx.clock.advance(0);
  await tick();
  assert.equal(socket.destroyed, false);
  assert.equal({}.polluted, undefined);
  assert.equal(valueOf(ctx.gladys, FEATURES.LATITUDE), 48.8584);
  assert.equal(statesOf(ctx.gladys, FEATURES.LATITUDE).length, 1, 'the out of range one never');
  assert.ok(ctx.logger.lines.some((l) => /gpsd error: Unrecognized request/.test(l)));
  assert.ok(!ctx.logger.lines.some((l) => l.includes('\u001b')), 'control characters cleaned');
});

test('the configured receiver is followed, the others listed', async (t) => {
  const ctx = await setup({ config: { ...CONFIG, receiver: '/dev/ttyUSB1' } });
  t.after(() => ctx.app.stop());
  const socket = ctx.connect.last();
  socket.open();
  socket.send(tpv());
  await ctx.clock.advance(0);
  await tick();
  assert.equal(ctx.gladys.fake.states.length, 0);
  await ctx.clock.advance(INTERVALS.STATUS_MIN_GAP_MS);
  assert.match(
    lastStatus(ctx.gladys).message.en,
    /nothing from \/dev\/ttyUSB1; gpsd reports \/dev\/ttyACM0/,
  );
  socket.send(tpv({ device: '/dev/ttyUSB1', lat: 10 }));
  await ctx.clock.advance(0);
  await tick();
  assert.equal(valueOf(ctx.gladys, FEATURES.LATITUDE), 10);
  const answer = await ctx.gladys.fake.action('test_connection', {});
  assert.match(answer.data.message.en, /Other receivers seen: \/dev\/ttyACM0/);
});

test('a SKY with uSat only keeps the satellites seen of the full one', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(sky(8, 11));
  socket.send({ class: 'SKY', device: PATH, hdop: 0.9, uSat: 8 });
  await ctx.clock.advance(0);
  await tick();
  assert.equal(valueOf(ctx.gladys, FEATURES.SATELLITES_SEEN), 11);
  socket.send({ class: 'SKY', device: PATH, uSat: 6 });
  await ctx.clock.advance(MINUTE);
  await tick();
  assert.equal(valueOf(ctx.gladys, FEATURES.SATELLITES_USED), 6);
  const answer = await ctx.gladys.fake.action('test_connection', {});
  assert.match(answer.data.message.en, /Satellites: 6 used, 11 seen/);
});

test('without a configured receiver, the first one that reports is followed', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv({ device: '/dev/ttyUSB0', lat: 1 }));
  socket.send(tpv({ lat: 2 }));
  socket.send(sky(3, 4, { device: '/dev/ttyACM0' }));
  await ctx.clock.advance(0);
  await tick();
  assert.equal(valueOf(ctx.gladys, FEATURES.LATITUDE), 1);
  assert.equal(statesOf(ctx.gladys, FEATURES.SATELLITES_USED).length, 0);
});

test('the followed receiver unplugged: its last fix is dropped, status says it', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv());
  await ctx.clock.advance(0);
  socket.send(tpv({ lat: 47 }));
  socket.send({ class: 'DEVICE', path: PATH });
  await tick();
  await ctx.clock.advance(INTERVALS.STATUS_MIN_GAP_MS);
  assert.match(lastStatus(ctx.gladys).message.en, /no active receiver/);
  await ctx.clock.advance(2 * MINUTE);
  await tick();
  assert.notEqual(valueOf(ctx.gladys, FEATURES.LATITUDE), 47);
});

test('gpsd without any receiver: said in the status', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = ctx.connect.last();
  socket.open();
  socket.send(devices([]));
  await tick();
  await ctx.clock.advance(INTERVALS.STATUS_MIN_GAP_MS);
  assert.match(lastStatus(ctx.gladys).message.en, /no active receiver/);
});

test('one status per state', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  for (let i = 0; i < 20; i += 1) {
    socket.send(tpv());
    socket.send(sky());
    await ctx.clock.advance(SECOND);
  }
  await tick();
  const fixes = ctx.gladys.fake.connectionStatuses.filter((s) =>
    /position fixed/.test(s.message?.en),
  );
  assert.equal(fixes.length, 1);
});

test('getConfig() failing in connected: retried, spaced, until it works', async (t) => {
  const ctx = await setup({ connected: false });
  t.after(() => ctx.app.stop());
  // Call 1 is the resynchronization of the SDK itself; the app's are 2 and 3.
  let calls = 0;
  const original = ctx.gladys.getConfig.bind(ctx.gladys);
  t.mock.method(ctx.gladys, 'getConfig', async () => {
    calls += 1;
    if (calls === 2 || calls === 3) throw new Error('503');
    return original();
  });
  await ctx.gladys.connect();
  await tick();
  assert.equal(ctx.connect.sockets.length, 0);
  assert.match(lastStatus(ctx.gladys).message.en, /could not be read.*10 s/);
  await ctx.clock.advance(INTERVALS.CONFIG_RETRY_MIN_MS);
  await tick();
  assert.match(lastStatus(ctx.gladys).message.en, /could not be read.*20 s/);
  assert.equal(ctx.connect.sockets.length, 0);
  await ctx.clock.advance(2 * INTERVALS.CONFIG_RETRY_MIN_MS);
  await tick();
  assert.equal(ctx.connect.sockets.length, 1);
  await watching(ctx);
  assert.equal(lastStatus(ctx.gladys).connected, true);
  assert.deepEqual(ctx.badTimers, []);
});

test('Gladys reconnecting keeps the gpsd connection; the same configuration too', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  await ctx.gladys.disconnect();
  await ctx.gladys.connect();
  await tick();
  await ctx.gladys.fake.configUpdated({ ...CONFIG });
  await tick();
  assert.equal(ctx.connect.sockets.length, 1);
  assert.equal(socket.destroyed, false);
  assert.equal(lastStatus(ctx.gladys).connected, true, 'status sent again');
});

test('another address: the old connection closed, a new one at once', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv());
  await ctx.gladys.fake.configUpdated({ ...CONFIG, host: 'gps.lan:2948' });
  await tick();
  assert.equal(socket.destroyed, true);
  assert.equal(ctx.connect.sockets.length, 2);
  assert.deepEqual(ctx.connect.last().options, { host: 'gps.lan', port: 2948 });
  await ctx.clock.advance(MINUTE);
  await tick();
  assert.equal(ctx.gladys.fake.states.length, 0, 'the report of the old gpsd is never published');
});

test('a shorter interval applies to the next round', async (t) => {
  const ctx = await setup({ config: { ...CONFIG, publish_interval: '900' } });
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv({ lat: 1 }));
  await ctx.clock.advance(SECOND);
  socket.send(tpv({ lat: 2 }));
  await ctx.clock.advance(SECOND);
  await ctx.gladys.fake.configUpdated({ ...CONFIG, publish_interval: '10' });
  await ctx.clock.advance(10 * SECOND);
  await tick();
  assert.equal(valueOf(ctx.gladys, FEATURES.LATITUDE), 2);
});

test('missing or invalid address, invalid receiver: no connection, a clear status', async (t) => {
  for (const [config, pattern] of [
    [{ host: '' }, /Type the address/],
    [{ host: '0.0.0.0' }, /not valid/],
    [{ host: '224.0.0.1' }, /not valid/],
    [{ host: 'gps.lan:70000' }, /not valid/],
    [{ host: 'gps.lan\r\nX' }, /not valid/],
    [{ host: 'gps.lan', receiver: '/dev/"x' }, /receiver is not valid/],
  ]) {
    const ctx = await setup({ config });
    t.after(() => ctx.app.stop());
    assert.equal(ctx.connect.sockets.length, 0, JSON.stringify(config));
    assert.match(lastStatus(ctx.gladys).message.en, pattern);
    const answer = await ctx.gladys.fake.action('test_connection', {});
    assert.equal(answer.success, true);
  }
});

test('the test button tells the state, never a coordinate, never a new connection', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv());
  socket.send(sky(7, 11));
  await ctx.clock.advance(0);
  for (let i = 0; i < 5; i += 1) await ctx.gladys.fake.action('test_connection', {});
  const answer = await ctx.gladys.fake.action('test_connection', {});
  assert.match(
    answer.data.message.en,
    /3D DGPS fix\. Satellites: 7 used, 11 seen\. Published at most every 60 s/,
  );
  assert.match(answer.data.message.fr, /position 3D DGPS/);
  assert.doesNotMatch(JSON.stringify(answer), /48\.8|2\.29/);
  assert.equal(ctx.connect.sockets.length, 1);
  socket.fail('ECONNRESET');
  await tick();
  const down = await ctx.gladys.fake.action('test_connection', {});
  assert.match(down.data.message.en, /Not connected: gpsd closed the connection\. Next try in 5 s/);
  assert.equal(ctx.connect.sockets.length, 1);
});

test('the position is never in the logs nor the statuses', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  t.mock.method(ctx.gladys, 'publishChangedStates', async () => {
    throw new Error('429 Too Many Requests');
  });
  socket.send(tpv());
  await ctx.clock.advance(0);
  await tick();
  socket.fail('ECONNRESET');
  await tick();
  const seen = JSON.stringify([ctx.logger.lines, ctx.gladys.fake.connectionStatuses]);
  assert.doesNotMatch(seen, /48\.8|2\.29|48,8/);
  assert.ok(ctx.logger.lines.some((l) => /states not published: 429/.test(l)));
});

test('a failed publication is sent again by the next round with new data', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  const original = ctx.gladys.publishChangedStates.bind(ctx.gladys);
  let fail = true;
  t.mock.method(ctx.gladys, 'publishChangedStates', async (...args) => {
    if (fail) {
      fail = false;
      throw new Error('500');
    }
    return original(...args);
  });
  socket.send(tpv());
  await ctx.clock.advance(0);
  await tick();
  assert.equal(ctx.gladys.fake.states.length, 0);
  socket.send(tpv());
  await ctx.clock.advance(MINUTE);
  await tick();
  assert.equal(valueOf(ctx.gladys, FEATURES.LATITUDE), 48.8584);
});

test('commands are refused: read only', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const [device] = ctx.gladys.fake.discoveredDevices;
  const ack = await ctx.gladys.fake.setValue(device, device.features[0], 1);
  assert.equal(ack.success, false);
  assert.match(String(ack.error?.message ?? ack.error), /Read only/);
});

test('stop: every timer cleared, the socket closed, nothing opened after', async (t) => {
  const ctx = await setup();
  const socket = await watching(ctx);
  socket.send(tpv());
  await ctx.clock.advance(0);
  socket.send(tpv());
  await ctx.app.stop();
  assert.equal(socket.destroyed, true);
  assert.equal(ctx.clock.pending, 0);
  await ctx.clock.advance(10 * MINUTE);
  assert.equal(ctx.connect.sockets.length, 1);
  // Stopped while retrying, or while the configuration is read again.
  const ctx2 = await setup();
  ctx2.connect.last().fail();
  await tick();
  await ctx2.app.stop();
  assert.equal(ctx2.clock.pending, 0);
  t.after(() => {});
});

test('a published device keeps the features of the created one', async (t) => {
  const ctx = await setup({ connected: false });
  const [device] = ctx.app.devices.call({
    config: { host: CONFIG.host, port: 2947 },
    gladys: ctx.gladys,
  });
  const extra = { ...device.features[0], external_id: F('old_feature') };
  ctx.gladys.fake.devices.push({ ...device, features: [...device.features, extra] });
  await ctx.gladys.connect();
  await tick();
  t.after(() => ctx.app.stop());
  const [published] = ctx.gladys.fake.discoveredDevices;
  assert.ok(published.features.some((f) => f.external_id === F('old_feature')));
});

test('a fix that comes and goes 10 times a second: statuses bounded', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  const before = ctx.gladys.fake.connectionStatuses.length;
  for (let i = 0; i < 600; i += 1) {
    socket.send(tpv({ mode: i % 2 ? 1 : 3, status: i % 3 === 0 ? 2 : undefined }));
    await ctx.clock.advance(100);
  }
  await ctx.clock.advance(INTERVALS.STATUS_MIN_GAP_MS);
  await tick();
  const sent = ctx.gladys.fake.connectionStatuses.length - before;
  assert.ok(sent <= 8, `${sent} statuses in a minute`);
  assert.ok(sent >= 1);
  assert.deepEqual(ctx.badTimers, []);
});

test('the course and speed of an epoch are never lost to a partial TPV', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  // gpsd 3.25: per epoch, a TPV without track nor speed, then the full one.
  // The round always falls right after the partial one.
  for (let epoch = 0; epoch < 3 * 60; epoch += 1) {
    socket.send(tpv({ track: 90 + epoch, speed: 10 + epoch / 10 }));
    await ctx.clock.advance(500);
    socket.send(tpv({ track: undefined, speed: undefined, eph: undefined }));
    await ctx.clock.advance(500);
  }
  await tick();
  const courses = statesOf(ctx.gladys, FEATURES.COURSE).map((s) => s.state);
  const speeds = statesOf(ctx.gladys, FEATURES.SPEED);
  assert.ok(courses.length >= 3, `courses ${courses}`);
  assert.ok(speeds.length >= 3);
  assert.equal(
    statesOf(ctx.gladys, FEATURES.HORIZONTAL_ERROR).length,
    1,
    'same value, deduplicated',
  );
});

test('a value is carried 3 s at most, never across a loss of fix, never the altitude in 2D', async (t) => {
  const ctx = await setup({ config: { ...CONFIG, publish_interval: '10' } });
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv({ track: 200, speed: 20 }));
  await ctx.clock.advance(10 * SECOND);
  socket.send(tpv({ lat: 1, track: undefined, speed: undefined, eph: undefined }));
  await ctx.clock.advance(10 * SECOND);
  await tick();
  assert.equal(statesOf(ctx.gladys, FEATURES.COURSE).length, 1, 'too old: not carried');
  socket.send(tpv({ track: 210, speed: 20 }));
  socket.send(tpv({ mode: 1 }));
  socket.send(tpv({ lat: 2, track: undefined, speed: undefined, altMSL: undefined }));
  await ctx.clock.advance(10 * SECOND);
  await tick();
  assert.deepEqual(
    statesOf(ctx.gladys, FEATURES.COURSE).map((s) => s.state),
    [200],
    'not across a loss of fix',
  );
  socket.send(tpv({ altMSL: 500 }));
  socket.send(tpv({ mode: 2, lat: 3, altMSL: undefined }));
  await ctx.clock.advance(10 * SECOND);
  await tick();
  assert.ok(
    !statesOf(ctx.gladys, FEATURES.ALTITUDE).some((s) => s.state === 500),
    'no altitude in 2D',
  );
});

test('a gpsd that closes after the banner: retries doubling, reset after a minute watching', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const delays = [];
  let socket = ctx.connect.last();
  for (let i = 0; i < 6; i += 1) {
    socket.open();
    await tick();
    assert.equal(socket.writes[0], '?WATCH={"enable":true,"json":true};\n', 'watching');
    socket.fail('ECONNRESET');
    await tick();
    const start = ctx.clock.elapsed;
    const before = ctx.connect.sockets.length;
    while (ctx.connect.sockets.length === before) await ctx.clock.advance(SECOND);
    delays.push(Math.round((ctx.clock.elapsed - start) / SECOND));
    socket = ctx.connect.last();
  }
  assert.deepEqual(delays, [5, 10, 20, 40, 80, 160]);
  socket.open();
  await ctx.clock.advance(INTERVALS.STABLE_MS - 2 * SECOND);
  socket.send(VERSION);
  socket.fail('ECONNRESET');
  await tick();
  assert.match(
    lastStatus(ctx.gladys).message.en,
    /Next try in 300 s/,
    'under a minute: still doubling',
  );
  await ctx.clock.advance(INTERVALS.RETRY_MAX_MS);
  socket = ctx.connect.last();
  socket.open();
  await ctx.clock.advance(INTERVALS.STABLE_MS + SECOND);
  socket.send(VERSION);
  socket.fail('ECONNRESET');
  await tick();
  assert.match(lastStatus(ctx.gladys).message.en, /Next try in 5 s/);
});

test('the first receiver that reports is released when gpsd deactivates it', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv({ lat: 1 }));
  await ctx.clock.advance(0);
  socket.send(tpv({ device: '/dev/ttyUSB0', lat: 2 }));
  // gpsd 3.25 says "removed" with a number, not an absent attribute.
  socket.send({ class: 'DEVICE', path: PATH, activated: 0 });
  socket.send(tpv({ device: '/dev/ttyUSB0', lat: 3 }));
  await ctx.clock.advance(MINUTE);
  await tick();
  assert.equal(valueOf(ctx.gladys, FEATURES.LATITUDE), 3);
});

test('Gladys back: the next fresh report is published whole again', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv());
  await ctx.clock.advance(0);
  await tick();
  const count = statesOf(ctx.gladys, FEATURES.LATITUDE).length;
  await ctx.gladys.disconnect();
  await ctx.gladys.connect();
  await tick();
  socket.send(tpv());
  await ctx.clock.advance(MINUTE);
  await tick();
  assert.equal(statesOf(ctx.gladys, FEATURES.LATITUDE).length, count + 1);
});

test('every published value lies within the min and max of its feature, at every precision', async () => {
  const ctx = await setup({ connected: false });
  const ids = { feature: (key) => `x:${key}` };
  const device = buildDevice(ctx.gladys, { host: 'gps.lan', port: 2947 });
  const range = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').at(-1), f]),
  );
  const extremes = [];
  for (const lat of [-90, -89.999999, 0, 89.999999, 90]) {
    for (const lon of [-180, 179.999999, 180]) {
      for (const [speed, track, alt, eph] of [
        [0, 0, LIMITS.ALTITUDE_MIN, 0],
        [LIMITS.SPEED_MAX, 359.9, LIMITS.ALTITUDE_MAX, LIMITS.HORIZONTAL_ERROR_MAX],
        [0.6, 359.5, -999.95, 0.04],
      ]) {
        extremes.push(readTpv(tpv({ lat, lon, speed, track, altMSL: alt, eph })));
      }
    }
  }
  extremes.push(readTpv(tpv({ mode: 1 })), readTpv(tpv({ mode: 2 })));
  const skies = [readSky(sky(0, 0)), readSky(sky(256, 300))];
  for (const decimals of [5, 4, 3, 2]) {
    for (const [i, one] of extremes.entries()) {
      for (const state of buildStates(ids, { tpv: one, sky: skies[i % 2] }, decimals)) {
        const key = state.device_feature_external_id.slice(2);
        const feature = range[key];
        if (state.text !== undefined) continue;
        assert.ok(
          state.state >= feature.min && state.state <= feature.max,
          `${key} ${state.state} out of ${feature.min}..${feature.max}`,
        );
      }
    }
  }
});

test('2D, 3D and DGPS alternating for 5 minutes: one "fixed" status only', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const socket = await watching(ctx);
  socket.send(tpv());
  await ctx.clock.advance(INTERVALS.STATUS_MIN_GAP_MS);
  const before = ctx.gladys.fake.connectionStatuses.length;
  for (let i = 0; i < 300; i += 1) {
    socket.send(tpv({ mode: 2 + (i % 2), status: i % 3 === 0 ? 2 : undefined }));
    await ctx.clock.advance(SECOND);
  }
  await tick();
  assert.equal(ctx.gladys.fake.connectionStatuses.length, before);
});
