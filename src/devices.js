// -----------------------------------------------------------------------------
// The Gladys device (pure).
//
//   receiver   `ext:<selector>:receiver:<key>`, the key a digest of the gpsd
//              address `host:port` (lowercase), 12 hexadecimal digits. Fixed:
//              another gpsd address makes another device. The receiver path
//              (`/dev/ttyACM0`) is not part of it: a receiver plugged on
//              another port stays the same device.
//
// Every feature is read only. The core has no category for coordinates:
// latitude and longitude are `unknown`/`unknown` without unit. Latitude,
// longitude, altitude, course and the fix text keep no history by default
// (together they draw a trip; the user may turn it on).
//
// A device published again never loses a feature: the features of the device
// created in Gladys (`gladys.devices`) are added back when the blueprint lacks
// them (the core would mark it `structure_changed`).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE, FEATURES, LIMITS } from './constants.js';

export const KEY_PATTERN = /^[0-9a-f]{12}$/;

/** The key of the device of a gpsd address. */
export const receiverKey = (host, port) =>
  createHash('sha256')
    .update(`gladys-gpsd:receiver:${String(host).toLowerCase()}:${port}`)
    .digest('hex')
    .slice(0, 12);

export const deviceIds = (gladys, key) => gladys.externalIds(DEVICE_TYPE, key);

const feature = (ids, key, name, spec, keepHistory = true) => ({
  name,
  external_id: ids.feature(key),
  read_only: true,
  has_feedback: false,
  keep_history: keepHistory,
  ...spec,
});

/** The features of the created device the blueprint lacks, appended (never fewer). */
export function withCreatedFeatures(device, devices) {
  const created = (devices ?? []).find((d) => d?.external_id === device.external_id);
  if (!created) return device;
  const known = new Set(device.features.map((f) => f.external_id));
  const extra = (created.features ?? []).filter(
    (f) => f && typeof f.external_id === 'string' && !known.has(f.external_id),
  );
  if (extra.length === 0) return device;
  return { ...device, features: [...device.features, ...extra] };
}

/** The device of the gpsd at `host:port`. */
export function buildDevice(gladys, { host, port }) {
  const ids = deviceIds(gladys, receiverKey(host, port));
  const features = [
    feature(
      ids,
      FEATURES.LATITUDE,
      'Latitude',
      { category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min: -90, max: 90 },
      false,
    ),
    feature(
      ids,
      FEATURES.LONGITUDE,
      'Longitude',
      { category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min: -180, max: 180 },
      false,
    ),
    feature(ids, FEATURES.SPEED, 'Speed', {
      category: C.SPEED_SENSOR,
      type: T.SENSOR.DECIMAL,
      unit: U.KILOMETER_PER_HOUR,
      min: 0,
      max: Math.round(LIMITS.SPEED_MAX * 3.6),
    }),
    feature(
      ids,
      FEATURES.ALTITUDE,
      'Altitude',
      {
        category: C.DISTANCE_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: U.M,
        min: LIMITS.ALTITUDE_MIN,
        max: LIMITS.ALTITUDE_MAX,
      },
      false,
    ),
    feature(
      ids,
      FEATURES.COURSE,
      'Course',
      {
        category: C.ANGLE_SENSOR,
        type: T.SENSOR.INTEGER,
        min: 0,
        max: 359,
      },
      false,
    ),
    // 1 no fix, 2 2D, 3 3D (gpsd `mode`); 0 "unknown" is never published.
    feature(ids, FEATURES.FIX_MODE, 'Fix mode', {
      category: C.UNKNOWN,
      type: T.UNKNOWN.UNKNOWN,
      min: 1,
      max: 3,
    }),
    feature(
      ids,
      FEATURES.FIX,
      'Fix',
      { category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0 },
      false,
    ),
    feature(ids, FEATURES.HORIZONTAL_ERROR, 'Horizontal error', {
      category: C.DISTANCE_SENSOR,
      type: T.SENSOR.DECIMAL,
      unit: U.M,
      min: 0,
      max: LIMITS.HORIZONTAL_ERROR_MAX,
    }),
    feature(ids, FEATURES.SATELLITES_USED, 'Satellites used', {
      category: C.COUNTER_SENSOR,
      type: T.SENSOR.INTEGER,
      min: 0,
      max: LIMITS.SATELLITES,
    }),
    feature(ids, FEATURES.SATELLITES_SEEN, 'Satellites seen', {
      category: C.COUNTER_SENSOR,
      type: T.SENSOR.INTEGER,
      min: 0,
      max: LIMITS.SATELLITES,
    }),
  ];
  return withCreatedFeatures(
    {
      name: 'GNSS receiver (gpsd)',
      external_id: ids.device,
      model: 'gpsd',
      should_poll: false,
      features,
    },
    gladys.devices,
  );
}
