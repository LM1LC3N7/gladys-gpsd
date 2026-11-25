# TODO — gpsd v1

Handoff document: what is done, what was decided, what comes next. Keep it up
to date at the end of every milestone.

## Status

- [x] **Milestone 1 — MVP** (2026-11-25, lot 25 wave 2): TCP connection to
      gpsd (gpsd JSON protocol: VERSION banner, `?WATCH` JSON only, TPV, SKY,
      DEVICE(S), ERROR); one read-only device per gpsd address (latitude,
      longitude, speed, altitude, course, fix mode, fix, horizontal error,
      satellites used / seen); position precision option; bounded pace;
      status per state; retries; test button; tests on the fake Gladys, local
      TCP fakes, a real sped-up clock; checked against a real gpsd 3.25 with
      `gpsfake` in a throwaway container.

## Decisions

- **Version 0.1.0** set by hand (package.json, lock, manifest, `docker_image`
  `ghcr.io/lm1lc3n7/gladys-gpsd:0.1.0`).
- **SDK `^0.16.1`** (latest on npm on 2026-11-25); `gladys_version: ">=5.1.0"`
  (no scene trigger, no `countries`: any country).
- **Categories** `vehicles` (camper van, boat) and `network` (presence /
  position). No `keywords` (would be: gps, gnss, gpsd, position, location,
  camper van, boat, nmea).
- **Reference**: the official document "gpsd JSON protocol"
  (<https://gpsd.gitlab.io/gpsd/gpsd_json.html>, read 2026-11-25); gpsd is
  BSD-2-Clause (COPYING), latest release 3.28. Protocol only, no code copied.
- **TCP only**: the receiver is on the gpsd machine; no USB, no serial, no
  NMEA parsing here (`?WATCH` asks JSON only).
- **The receiver path is never sent** in `?WATCH`: a request is at most 80
  characters, too short for `/dev/serial/by-id/...` paths; reports are filtered
  on their `device` instead. Empty: the first receiver that reports is followed
  for the connection.
- **Identity**: digest of `host:port` (12 hex). Another address = another
  device; the receiver path is not part of it (a receiver moved to another USB
  port stays the same device).
- **Altitude**: `altMSL`, else the old `alt` (gpsd < 3.20, MSL); never `altHAE`
  (ellipsoid). 3D fix only. Rounded with the precision (0.1 m to 100 m) so that
  a coarse position is not given away by a precise altitude on a relief map.
- **Course** only above 2 km/h (noise when still). **Horizontal error** = `eph`
  only (absent: unknown, no estimate from `epx`/`epy`).
- **Fix mode 0** ("unknown") is never published; mode 1 publishes the mode and
  the text `no fix`, never a position.
- **Pace**: newest TPV / SKY kept, one round at most per interval, the first at
  once; a round without new data publishes nothing; the reports are dropped
  when the connection ends or the followed receiver is deactivated (DEVICE
  without `activated`). `publishChangedStates` with a heartbeat of 1 h.
- **No `/data`**: nothing to persist (no secret, no refusal, no pause); the
  last report is never replayed after a restart.
- **Silence**: 60 s without a line -> `?VERSION;`; 10 s without an answer ->
  closed, retried. Retry 5 s doubling to 5 min, reset after a connection that
  lived 60 s watching.
- **Gladys disconnected**: the gpsd connection is kept; a failed publication
  is logged (count only, never values) and the next round with new data sends
  everything again (the SDK remembers only what Gladys accepted).
- **Test button**: tells the current state; never opens a connection (never
  faster than the retry pace), never a coordinate.
- **CI**: `timeout-minutes` on every job (30 min, 60 for the multi-arch build).
- **Review r1** (2026-11-25): the status key holds no fix kind and a watching
  status is sent at most every 10 s (`STATUS_MIN_GAP_MS`), failures at once;
  TPV values merged per field within 3 s of the same fix (`TPV_CARRY_MS`,
  never the status, the altitude only in 3D, lat/lon together); the "first
  that reports" receiver is released by its DEVICE `activated` absent or 0;
  altitude and course without history by default. Equivalent mutant left
  out: the key check of `setStatus` (`refreshStatus` already compares the key,
  failure keys carry their count).

## Next

- [ ] Feedback from a user with a real receiver (u-blox, SiRF...) and a real
      gpsd on a Raspberry Pi in a van or a boat.
- [ ] Maybe a scene trigger "fix lost / fix back", and a geofence trigger
      (distance from home, with a hysteresis), without putting coordinates in
      the event.
- [ ] Gladys has no host API to move a user on its map: if the core adds one,
      offer to link the receiver to a user.
- [ ] Speed in knots for boats needs a core unit (`speed-sensor` only knows
      m/s and km/h).
