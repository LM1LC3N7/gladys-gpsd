// -----------------------------------------------------------------------------
// From the last reports of gpsd to the states of the device (pure).
//
// Only what gpsd said is published: an absent value stays unknown (never 0).
// The latitude and longitude are rounded to the decimals of the configuration
// (5: ~1 m, 4: ~11 m, 3: ~110 m, 2: ~1.1 km). The course is published only
// above LIMITS.COURSE_MIN_SPEED (below, it is noise). The altitude follows the
// same choice (5: 0.1 m, 4: 1 m, 3: 10 m, 2: 100 m): with a coarse position, a
// precise altitude could tell the place on a relief map.
// -----------------------------------------------------------------------------

import { FEATURES, LIMITS, MODES, STATUS_NAMES } from './constants.js';

/** Rounds half away from zero to `decimals` (negative: tens, hundreds); never -0. */
export function roundTo(value, decimals) {
  const abs = Math.abs(value);
  const rounded =
    decimals >= 0
      ? Math.round(abs * 10 ** decimals) / 10 ** decimals
      : Math.round(abs / 10 ** -decimals) * 10 ** -decimals;
  return rounded === 0 ? 0 : Math.sign(value) * rounded;
}

/** The values of a TPV taken from an earlier one of the same fix when missing. */
const CARRIED = ['lat', 'lon', 'alt', 'speed', 'track', 'eph'];

/**
 * Merges a TPV into the last one (pure). `prev` is `{ tpv, at }`, `at` the
 * monotonic time each value was last given. A value the new TPV lacks is kept
 * from `prev` when given within `maxAgeMs` and both are 2D/3D fixes; the
 * altitude only in 3D; latitude and longitude only together. The status is
 * never carried (absent means "normal" in gpsd). -> { tpv, at }.
 */
export function mergeTpv(prev, next, mono, maxAgeMs) {
  const at = {};
  const tpv = { ...next };
  const carry = prev && prev.tpv.mode >= MODES.FIX_2D && next.mode >= MODES.FIX_2D;
  for (const key of CARRIED) {
    if (next[key] !== null) {
      at[key] = mono;
    } else if (
      carry &&
      prev.tpv[key] !== null &&
      prev.at?.[key] != null &&
      mono - prev.at[key] <= maxAgeMs &&
      !(key === 'alt' && next.mode !== MODES.FIX_3D)
    ) {
      tpv[key] = prev.tpv[key];
      at[key] = prev.at[key];
    } else {
      tpv[key] = null;
      at[key] = null;
    }
  }
  if (tpv.lat === null || tpv.lon === null) {
    tpv.lat = null;
    tpv.lon = null;
  }
  return { tpv, at };
}

/** The text of the Fix feature: `no fix`, `2D`, `3D`, `3D DGPS`... */
export function fixText(mode, status) {
  if (mode === MODES.NO_FIX) return 'no fix';
  if (mode !== MODES.FIX_2D && mode !== MODES.FIX_3D) return null;
  const name = STATUS_NAMES[status];
  return name ? `${mode}D ${name}` : `${mode}D`;
}

/**
 * @param {{ feature: (key: string) => string }} ids the ids of the device
 * @param {{ tpv?: object | null, sky?: object | null }} reports new since the last round
 * @param {number} decimals of the latitude and longitude
 * @returns the entries of publishChangedStates
 */
export function buildStates(ids, { tpv = null, sky = null }, decimals) {
  const states = [];
  const put = (key, state) => states.push({ device_feature_external_id: ids.feature(key), state });
  if (tpv && tpv.mode >= MODES.NO_FIX) {
    put(FEATURES.FIX_MODE, tpv.mode);
    states.push({
      device_feature_external_id: ids.feature(FEATURES.FIX),
      text: fixText(tpv.mode, tpv.status),
    });
    if (tpv.lat !== null && tpv.lon !== null) {
      put(FEATURES.LATITUDE, roundTo(tpv.lat, decimals));
      put(FEATURES.LONGITUDE, roundTo(tpv.lon, decimals));
      if (tpv.alt !== null) put(FEATURES.ALTITUDE, roundTo(tpv.alt, decimals - 4));
      if (tpv.speed !== null) {
        const kmh = roundTo(tpv.speed * 3.6, 1);
        put(FEATURES.SPEED, kmh);
        if (tpv.track !== null && kmh >= LIMITS.COURSE_MIN_SPEED) {
          put(FEATURES.COURSE, Math.round(tpv.track) % 360);
        }
      }
      if (tpv.eph !== null) put(FEATURES.HORIZONTAL_ERROR, roundTo(tpv.eph, 1));
    }
  }
  if (sky) {
    if (sky.used !== null) put(FEATURES.SATELLITES_USED, sky.used);
    if (sky.seen !== null) put(FEATURES.SATELLITES_SEEN, sky.seen);
  }
  return states;
}
