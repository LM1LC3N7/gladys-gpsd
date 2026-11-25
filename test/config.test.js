// -----------------------------------------------------------------------------
// The configuration: the gpsd address, the receiver path, the choices.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseAddress, parseReceiver, sameTarget } from '../src/config.js';

test('addresses: names, IPv4, IPv6, with or without a port', () => {
  assert.deepEqual(parseAddress('192.168.1.40'), { host: '192.168.1.40', port: 2947 });
  assert.deepEqual(parseAddress(' GPS.lan:2948 '), { host: 'gps.lan', port: 2948 });
  assert.deepEqual(parseAddress('gps.lan\n'), { host: 'gps.lan', port: 2947 }, 'trimmed');
  assert.deepEqual(parseAddress('localhost'), { host: 'localhost', port: 2947 });
  assert.deepEqual(parseAddress('fd00::12'), { host: 'fd00::12', port: 2947 });
  assert.deepEqual(parseAddress('[fd00::12]:3000'), { host: 'fd00::12', port: 3000 });
});

test('addresses refused: empty, any, broadcast, multicast, bad port, control characters', () => {
  assert.deepEqual(parseAddress(''), { error: 'missing' });
  assert.deepEqual(parseAddress(undefined), { error: 'missing' });
  for (const bad of [
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.251',
    '239.1.2.3',
    '::',
    'ff02::1',
    '[ff02::1]:2947',
    'gps.lan:0',
    'gps.lan:65536',
    'gps.lan:12a',
    'gps.lan:',
    'gps lan',
    'gps\tlan',
    'gps.lan\r\nHost: x',
    'http://gps.lan',
    '999.1.1.1',
    '1.2.3',
    'a:b:c',
    '-gps.lan',
    `${'a'.repeat(64)}.lan`,
  ]) {
    assert.deepEqual(parseAddress(bad), { error: 'invalid' }, JSON.stringify(bad));
  }
});

test('receiver: a printable path or nothing', () => {
  assert.deepEqual(parseReceiver(''), { receiver: null });
  assert.deepEqual(parseReceiver(' /dev/ttyACM0 '), { receiver: '/dev/ttyACM0' });
  const byId = '/dev/serial/by-id/usb-u-blox_AG_-_www.u-blox.com_u-blox_7_-_GPS_GNSS_Receiver-if00';
  assert.deepEqual(parseReceiver(byId), { receiver: byId });
  for (const bad of ['/dev/"x', '/dev/x\\y', '/dev/tty ACM0', '/dev/\u0007', 'x'.repeat(129)]) {
    assert.deepEqual(parseReceiver(bad), { error: 'invalid' }, bad);
  }
});

test('choices: only the listed ones, else the defaults', () => {
  const base = normalizeConfig({ host: 'gps.lan' });
  assert.equal(base.publishSeconds, 60);
  assert.equal(base.decimals, 4);
  const set = normalizeConfig({ host: 'gps.lan', publish_interval: '10', precision: '2' });
  assert.equal(set.publishSeconds, 10);
  assert.equal(set.decimals, 2);
  const odd = normalizeConfig({ host: 'gps.lan', publish_interval: '1', precision: '9' });
  assert.equal(odd.publishSeconds, 60);
  assert.equal(odd.decimals, 4);
  assert.equal(normalizeConfig(null).addressError, 'missing');
});

test('same target: host, port and receiver', () => {
  const a = normalizeConfig({ host: 'gps.lan' });
  assert.ok(sameTarget(a, normalizeConfig({ host: 'GPS.lan:2947', publish_interval: '10' })));
  assert.ok(!sameTarget(a, normalizeConfig({ host: 'gps.lan:2948' })));
  assert.ok(!sameTarget(a, normalizeConfig({ host: 'gps.lan', receiver: '/dev/ttyACM0' })));
  assert.ok(!sameTarget(null, a));
});
