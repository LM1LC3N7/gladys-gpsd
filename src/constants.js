// -----------------------------------------------------------------------------
// Keys, limits and timings. The manifest keys and the external id shapes are
// stored in user devices and scenes: never rename them (test/manifest.test.js
// ties them to the manifest).
// -----------------------------------------------------------------------------

export const ACTIONS = Object.freeze({
  TEST: 'test_connection',
});

/** The TCP port of gpsd (IANA), used when the address gives none. */
export const DEFAULT_PORT = 2947;

/**
 * Device external id: `ext:<selector>:receiver:<key>`, the key being a digest
 * of the gpsd address `host:port` (src/devices.js). Another address makes
 * another device.
 */
export const DEVICE_TYPE = 'receiver';

export const FEATURES = Object.freeze({
  LATITUDE: 'latitude',
  LONGITUDE: 'longitude',
  SPEED: 'speed',
  ALTITUDE: 'altitude',
  COURSE: 'course',
  FIX_MODE: 'fix_mode',
  FIX: 'fix',
  HORIZONTAL_ERROR: 'horizontal_error',
  SATELLITES_USED: 'satellites_used',
  SATELLITES_SEEN: 'satellites_seen',
});

/** Seconds between two publications (the manifest choices). */
export const PUBLISH_INTERVALS = Object.freeze(['10', '30', '60', '300', '900']);

/** Decimals kept on the latitude and longitude (the manifest choices). */
export const PRECISIONS = Object.freeze(['5', '4', '3', '2']);

/** gpsd modes: 0 unknown (never published), 1 no fix, 2 2D, 3 3D. */
export const MODES = Object.freeze({ UNKNOWN: 0, NO_FIX: 1, FIX_2D: 2, FIX_3D: 3 });

/** gpsd TPV `status` (gpsd JSON protocol): the quality said after the mode. */
export const STATUS_NAMES = Object.freeze({
  2: 'DGPS',
  3: 'RTK fixed',
  4: 'RTK float',
  5: 'DR',
  6: 'GNSS+DR',
  7: 'surveyed',
  8: 'simulated',
  9: 'P(Y)',
});

export const LIMITS = Object.freeze({
  /** gpsd answers at most 10240 characters per object; a longer line is dropped. */
  LINE_BYTES: 16 * 1024,
  /** A receiver path (`/dev/serial/by-id/...` can be long), compared whole. */
  PATH_CHARS: 128,
  /** Satellites read from one SKY report. */
  SATELLITES: 256,
  /** Other receiver paths remembered for the status. */
  OTHER_RECEIVERS: 8,
  /** A text of gpsd (version, error, path) shown in the status. */
  TEXT_CHARS: 80,
  /** Bytes read per second on the gpsd connection before it is closed. */
  BYTES_PER_SECOND: 256 * 1024,
  /** Fastest physical speed taken as a measure (m/s, an airliner is ~250). */
  SPEED_MAX: 400,
  ALTITUDE_MIN: -1000,
  ALTITUDE_MAX: 50_000,
  HORIZONTAL_ERROR_MAX: 100_000,
  /** Under this speed (km/h) the course is noise: not published. */
  COURSE_MIN_SPEED: 2,
});

export const TIMEOUTS = Object.freeze({
  /** TCP connection to gpsd. */
  CONNECT: 10_000,
  /** The VERSION banner gpsd sends at once. */
  HELLO: 5_000,
  /** Silence of the connection after which gpsd is asked its version. */
  PROBE_AFTER: 60_000,
  /** Answer to that question. */
  PROBE_ANSWER: 10_000,
});

export const INTERVALS = Object.freeze({
  /** A failed or lost connection is tried again after this, doubling. */
  RETRY_MIN_MS: 5_000,
  RETRY_MAX_MS: 5 * 60_000,
  /** A connection that lived this long, watching, resets the doubling. */
  STABLE_MS: 60_000,
  /** getConfig() failed: read again after this, doubling. */
  CONFIG_RETRY_MIN_MS: 10_000,
  CONFIG_RETRY_MAX_MS: 5 * 60_000,
  /** An unchanged value is published again once this old (stays dated in Gladys). */
  HEARTBEAT_MS: 3600_000,
  /** Two statuses of a watching connection are at least this far apart. */
  STATUS_MIN_GAP_MS: 10_000,
  /** A TPV value missing from a report is taken from one at most this old (same fix). */
  TPV_CARRY_MS: 3_000,
});
