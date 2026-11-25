// -----------------------------------------------------------------------------
// Reading the gpsd JSON protocol (pure). Written from the official document
// "gpsd JSON protocol" (https://gpsd.gitlab.io/gpsd/gpsd_json.html), no code of
// gpsd copied. Each answer is one JSON object per line, ended by CR LF, at
// most 10240 characters (a longer one is cut by gpsd: invalid JSON, ignored).
// gpsd never sends JSON null: an absent attribute is unknown.
// -----------------------------------------------------------------------------

import { LIMITS, MODES } from '../constants.js';

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, min, max) => (isNumber(v) && v >= min && v <= max ? v : null);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** A text of gpsd shown to people: printable, bounded. */
export function cleanText(value, max = LIMITS.TEXT_CHARS) {
  if (typeof value !== 'string') return null;
  const cleaned = value
    // eslint-disable-next-line no-control-regex -- control characters are what is removed
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** One line -> a plain object with a string `class`, or null. */
export function parseLine(line) {
  if (typeof line !== 'string' || line.length === 0) return null;
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.class !== 'string') return null;
  return value;
}

/** VERSION: { release, protoMajor, protoMinor } or null. */
export function readVersion(obj) {
  if (obj?.class !== 'VERSION') return null;
  if (!isInt(obj.proto_major, 0, 1000) || !isInt(obj.proto_minor, 0, 100_000)) return null;
  // The table says `release`, the example of the document `version`.
  const release = cleanText(obj.release ?? obj.version, 32);
  return { release, protoMajor: obj.proto_major, protoMinor: obj.proto_minor };
}

/** The originating receiver of a report, or null when gpsd omits it (one receiver). */
const pathOf = (obj) =>
  typeof obj.device === 'string' && /^[\x21-\x7e]{1,128}$/.test(obj.device) ? obj.device : null;

/**
 * TPV -> { path, mode, status, time, lat, lon, alt, speed, track, eph } or
 * null. A position needs a 2D or 3D mode and both coordinates in range; the
 * altitude a 3D mode. Every other value is null when absent or out of range
 * (never 0 for "unknown").
 */
export function readTpv(obj) {
  if (obj?.class !== 'TPV') return null;
  if (!isInt(obj.mode, 0, 3)) return null;
  const mode = obj.mode;
  const fix = mode >= MODES.FIX_2D;
  const lat = fix ? inRange(obj.lat, -90, 90) : null;
  const lon = fix ? inRange(obj.lon, -180, 180) : null;
  const hasPosition = lat !== null && lon !== null;
  // altMSL since gpsd 3.20; before it, `alt` was the altitude above sea level.
  const altRaw = isNumber(obj.altMSL) ? obj.altMSL : obj.alt;
  const alt =
    hasPosition && mode === MODES.FIX_3D
      ? inRange(altRaw, LIMITS.ALTITUDE_MIN, LIMITS.ALTITUDE_MAX)
      : null;
  return {
    path: pathOf(obj),
    mode,
    status: isInt(obj.status, 0, 99) ? obj.status : null,
    time: typeof obj.time === 'string' && obj.time.length <= 40 ? obj.time : null,
    lat: hasPosition ? lat : null,
    lon: hasPosition ? lon : null,
    alt,
    speed: hasPosition ? inRange(obj.speed, 0, LIMITS.SPEED_MAX) : null,
    track: hasPosition ? inRange(obj.track, 0, 360) : null,
    eph: hasPosition ? inRange(obj.eph, 0, LIMITS.HORIZONTAL_ERROR_MAX) : null,
  };
}

/**
 * SKY -> { path, used, seen } or null. From the satellites list when given
 * (bounded), else from `uSat` / `nSat`. A SKY with neither (gpsd sends some
 * with the DOPs only) says nothing about the satellites: null.
 */
export function readSky(obj) {
  if (obj?.class !== 'SKY') return null;
  let used = null;
  let seen = null;
  if (Array.isArray(obj.satellites)) {
    const list = obj.satellites.slice(0, LIMITS.SATELLITES);
    seen = 0;
    used = 0;
    for (const sat of list) {
      if (!sat || typeof sat !== 'object') continue;
      seen += 1;
      if (sat.used === true) used += 1;
    }
  }
  if (used === null && isInt(obj.uSat, 0, LIMITS.SATELLITES)) used = obj.uSat;
  if (seen === null && isInt(obj.nSat, 0, LIMITS.SATELLITES)) seen = obj.nSat;
  if (used === null && seen === null) return null;
  if (used !== null && seen !== null && used > seen) seen = used;
  return { path: pathOf(obj), used, seen };
}

/** DEVICE -> { path, active } or null (`activated` absent: inactive). */
export function readDevice(obj) {
  if (obj?.class !== 'DEVICE') return null;
  return { path: pathOf({ device: obj.path }), active: typeof obj.activated === 'string' };
}

/** DEVICES -> [{ path, active }] (bounded) or null. */
export function readDevices(obj) {
  if (obj?.class !== 'DEVICES' || !Array.isArray(obj.devices)) return null;
  return obj.devices
    .slice(0, LIMITS.OTHER_RECEIVERS * 2)
    .filter((d) => d && typeof d === 'object')
    .map((d) => readDevice({ ...d, class: 'DEVICE' }));
}

/** ERROR -> its message (cleaned) or null. */
export function readError(obj) {
  if (obj?.class !== 'ERROR') return null;
  return cleanText(obj.message) ?? 'unknown error';
}

/**
 * The ?WATCH request: JSON reports of every receiver (never NMEA nor raw);
 * the receiver chosen in the configuration is picked from their `device`.
 */
export const WATCH_REQUEST = '?WATCH={"enable":true,"json":true};\n';

/** The question asked after a silence: gpsd answers a VERSION object. */
export const PROBE_REQUEST = '?VERSION;\n';
