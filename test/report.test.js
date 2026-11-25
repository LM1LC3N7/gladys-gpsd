// -----------------------------------------------------------------------------
// From reports to states: rounding, units, unknowns.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES } from '../src/constants.js';
import { readSky, readTpv } from '../src/gpsd/parse.js';
import { buildStates, fixText, roundTo } from '../src/report.js';
import { sky, tpv } from './helpers/gpsd.js';

const ids = { feature: (key) => `f:${key}` };
const asMap = (states) =>
  Object.fromEntries(states.map((s) => [s.device_feature_external_id.slice(2), s.text ?? s.state]));

test('roundTo: half away from zero, tens and hundreds, never -0', () => {
  assert.equal(roundTo(48.85837, 4), 48.8584);
  assert.equal(roundTo(-0.00004, 4), 0);
  assert.ok(!Object.is(roundTo(-0.00004, 4), -0));
  assert.equal(roundTo(-1.25, 1), -1.3);
  assert.equal(roundTo(1234.5, -1), 1230);
  assert.equal(roundTo(1250, -2), 1300);
  assert.equal(roundTo(-35, -1), -40);
});

test('precision choices: 5, 4, 3, 2 decimals; altitude 0.1, 1, 10, 100 m', () => {
  const read = readTpv(tpv({ lat: -33.868819, lon: 151.209295, altMSL: 1234.56 }));
  const at = (d) => asMap(buildStates(ids, { tpv: read }, d));
  assert.deepEqual(
    [at(5).latitude, at(5).longitude, at(5).altitude],
    [-33.86882, 151.2093, 1234.6],
  );
  assert.deepEqual([at(4).latitude, at(4).longitude, at(4).altitude], [-33.8688, 151.2093, 1235]);
  assert.deepEqual([at(3).latitude, at(3).longitude, at(3).altitude], [-33.869, 151.209, 1230]);
  assert.deepEqual([at(2).latitude, at(2).longitude, at(2).altitude], [-33.87, 151.21, 1200]);
});

test('units: m/s to km/h, course only when moving, error to 0.1 m', () => {
  const moving = asMap(buildStates(ids, { tpv: readTpv(tpv({ speed: 13.9, track: 359.6 })) }, 4));
  assert.equal(moving.speed, 50);
  assert.equal(moving.course, 0);
  assert.equal(moving.horizontal_error, 4.3);
  const still = asMap(buildStates(ids, { tpv: readTpv(tpv({ speed: 0.5, track: 200 })) }, 4));
  assert.equal(still.speed, 1.8);
  assert.equal(still.course, undefined);
});

test('the fix text', () => {
  assert.equal(fixText(1, 2), 'no fix');
  assert.equal(fixText(2), '2D');
  assert.equal(fixText(3, 3), '3D RTK fixed');
  assert.equal(fixText(3, 1), '3D');
  assert.equal(fixText(0), null);
});

test('only what is known: sky alone, nothing at all', () => {
  assert.deepEqual(asMap(buildStates(ids, { sky: readSky(sky(4, 9)) }, 4)), {
    [FEATURES.SATELLITES_USED]: 4,
    [FEATURES.SATELLITES_SEEN]: 9,
  });
  assert.deepEqual(buildStates(ids, {}, 4), []);
  assert.deepEqual(buildStates(ids, { tpv: readTpv(tpv({ mode: 0 })) }, 4), []);
  const noFix = asMap(buildStates(ids, { tpv: readTpv(tpv({ mode: 1 })) }, 4));
  assert.deepEqual(noFix, { fix_mode: 1, fix: 'no fix' });
});
