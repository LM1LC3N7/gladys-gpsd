// -----------------------------------------------------------------------------
// Reading the gpsd JSON protocol: reports, bounds, lines.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WATCH_REQUEST,
  cleanText,
  parseLine,
  readDevice,
  readDevices,
  readError,
  readSky,
  readTpv,
  readVersion,
} from '../src/gpsd/parse.js';
import { LineReader } from '../src/gpsd/session.js';
import { VERSION, sky, tpv } from './helpers/gpsd.js';

test('the WATCH request: JSON only, never NMEA nor raw, within 80 characters', () => {
  assert.equal(WATCH_REQUEST, '?WATCH={"enable":true,"json":true};\n');
  assert.ok(WATCH_REQUEST.length - 1 <= 80);
  assert.doesNotMatch(WATCH_REQUEST, /nmea|raw/);
});

test('VERSION: release or version, protocol numbers', () => {
  assert.deepEqual(readVersion(VERSION), { release: '3.25', protoMajor: 3, protoMinor: 15 });
  assert.deepEqual(
    readVersion({ class: 'VERSION', version: '2.40dev', proto_major: 3, proto_minor: 1 }),
    {
      release: '2.40dev',
      protoMajor: 3,
      protoMinor: 1,
    },
  );
  assert.equal(
    readVersion({ class: 'VERSION', release: '3', proto_major: '3', proto_minor: 1 }),
    null,
  );
  assert.equal(readVersion({ class: 'TPV' }), null);
});

test('TPV: a 3D fix whole', () => {
  assert.deepEqual(readTpv(tpv()), {
    path: '/dev/ttyACM0',
    mode: 3,
    status: 2,
    time: '2026-11-25T10:00:00.000Z',
    lat: 48.858370123,
    lon: 2.294481456,
    alt: 35.42,
    speed: 5,
    track: 123.4,
    eph: 4.25,
  });
});

test('TPV: altitude only in 3D, from altMSL, else the old alt', () => {
  assert.equal(readTpv(tpv({ mode: 2 })).alt, null);
  assert.equal(readTpv(tpv({ altMSL: undefined, alt: 12 })).alt, 12);
  assert.equal(readTpv(tpv({ altMSL: undefined })).alt, null, 'altHAE is not the altitude shown');
  assert.equal(readTpv(tpv({ altMSL: 60_000 })).alt, null);
});

test('TPV: no position without a fix or with a coordinate out of range', () => {
  for (const extra of [
    { mode: 1 },
    { mode: 0 },
    { lat: 90.0001 },
    { lon: -180.5 },
    { lat: '48.8' },
    { lon: undefined },
    { lat: null },
  ]) {
    const read = readTpv(tpv(extra));
    assert.equal(read.lat, null, JSON.stringify(extra));
    assert.equal(read.lon, null, JSON.stringify(extra));
    assert.equal(read.speed, null);
    assert.equal(read.eph, null);
  }
  assert.equal(readTpv(tpv({ mode: 4 })), null);
  assert.equal(readTpv(tpv({ mode: '3' })), null);
  assert.equal(readTpv(tpv({ mode: 2.5 })), null);
});

test('TPV: values out of range or not numbers are unknown, never 0', () => {
  const read = readTpv(tpv({ speed: -1, track: 400, eph: 'NaN', status: 'x', time: 5 }));
  assert.equal(read.speed, null);
  assert.equal(read.track, null);
  assert.equal(read.eph, null);
  assert.equal(read.status, null);
  assert.equal(read.time, null);
  assert.equal(readTpv(tpv({ speed: 1e9 })).speed, null);
});

test('TPV: device path kept whole when printable, else null', () => {
  const long = `/dev/serial/by-id/${'x'.repeat(100)}`;
  assert.equal(readTpv(tpv({ device: long })).path, long);
  assert.equal(readTpv(tpv({ device: 'x'.repeat(129) })).path, null);
  assert.equal(readTpv(tpv({ device: '/dev/a b' })).path, null);
  assert.equal(readTpv(tpv({ device: undefined })).path, null);
});

test('SKY: from the satellites list (bounded), else uSat / nSat; DOPs only: nothing', () => {
  assert.deepEqual(readSky(sky(7, 11)), { path: '/dev/ttyACM0', used: 7, seen: 11 });
  assert.deepEqual(readSky({ class: 'SKY', uSat: 5, nSat: 9 }), { path: null, used: 5, seen: 9 });
  assert.deepEqual(readSky({ class: 'SKY', uSat: 5 }), { path: null, used: 5, seen: null });
  assert.equal(readSky({ class: 'SKY', hdop: 1.2 }), null);
  assert.equal(readSky({ class: 'SKY', uSat: -1, nSat: 1.5 }), null);
  const huge = readSky(sky(1000, 1000));
  assert.equal(huge.seen, 256);
  assert.equal(huge.used, 256);
  assert.deepEqual(readSky({ class: 'SKY', satellites: [null, 3, { used: 'yes' }] }), {
    path: null,
    used: 0,
    seen: 1,
  });
});

test('DEVICE, DEVICES and ERROR', () => {
  assert.deepEqual(
    readDevice({ class: 'DEVICE', path: '/dev/ttyACM0', activated: '2026-11-25T10:00:00Z' }),
    {
      path: '/dev/ttyACM0',
      active: true,
    },
  );
  assert.deepEqual(readDevice({ class: 'DEVICE', path: '/dev/ttyACM0' }), {
    path: '/dev/ttyACM0',
    active: false,
  });
  assert.deepEqual(readDevices({ class: 'DEVICES', devices: [] }), []);
  assert.equal(readDevices({ class: 'DEVICES', devices: 'x' }), null);
  assert.equal(
    readDevices({ class: 'DEVICES', devices: new Array(100).fill({ path: '/x' }) }).length,
    16,
  );
  assert.equal(
    readError({ class: 'ERROR', message: 'bad\u001b[31m  request' }),
    'bad [31m request',
  );
  assert.equal(readError({ class: 'ERROR' }), 'unknown error');
});

test('cleanText bounds and cleans', () => {
  assert.equal(cleanText('x'.repeat(200)).length, 80);
  assert.equal(cleanText('  \n '), null);
  assert.equal(cleanText(3), null);
});

test('parseLine: objects with a string class only', () => {
  assert.deepEqual(parseLine('{"class":"TPV","mode":1}'), { class: 'TPV', mode: 1 });
  for (const bad of ['', 'x', '[]', 'null', '1', '{"class":1}', '{"mode":1}', '{"class":"TPV"']) {
    assert.equal(parseLine(bad), null, bad);
  }
  const polluted = parseLine('{"class":"X","__proto__":{"polluted":true}}');
  assert.equal({}.polluted, undefined);
  assert.equal(polluted.polluted, undefined);
});

test('LineReader: lines split anywhere, CR dropped, a long line dropped up to its newline', () => {
  const reader = new LineReader(32);
  assert.deepEqual(reader.push(Buffer.from('{"a":')), []);
  assert.deepEqual(reader.push(Buffer.from('1}\r\n{"b"')), ['{"a":1}']);
  assert.deepEqual(reader.push(Buffer.from(':2}\n')), ['{"b":2}']);
  assert.deepEqual(reader.push(Buffer.from('x'.repeat(40))), []);
  assert.deepEqual(reader.push(Buffer.from('y'.repeat(40))), [], 'still skipping');
  assert.deepEqual(reader.push(Buffer.from('zz\nok\n')), ['ok']);
  assert.equal(reader.oversized, 1);
  assert.deepEqual(reader.push(Buffer.from(`${'w'.repeat(20)}`)), []);
  assert.deepEqual(reader.push(Buffer.from(`${'w'.repeat(20)}\nok2\n`)), ['ok2']);
  assert.equal(reader.oversized, 2);
  // UTF-8 split across chunks.
  const bytes = Buffer.from('"é"\n');
  assert.deepEqual(
    [...reader.push(bytes.subarray(0, 2)), ...reader.push(bytes.subarray(2))],
    ['"é"'],
  );
});
