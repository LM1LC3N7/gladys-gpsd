# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version, never tested with a real receiver (tested with gpsd 3.25 and
  `gpsfake` replaying an NMEA log): the GNSS receiver shared by gpsd on the
  network, read through the gpsd JSON protocol over TCP (port 2947 by default,
  `?WATCH` with JSON reports only). Read only.
- One Gladys device per gpsd address: latitude, longitude, speed (km/h),
  altitude (above sea level), course, fix mode, fix (text), horizontal error and
  satellites used / seen.
- Position precision of about 1 m, 10 m (default), 100 m or 1 km: latitude,
  longitude and altitude rounded before they reach Gladys; no position history
  by default; never a coordinate in the logs, the status or the test button.
- Publication at most every 10 seconds to 15 minutes (every minute by default),
  only the values that changed, never an old report again.
- Optional receiver path when gpsd reads several receivers.
- Status of the connection (fix, no fix, no receiver, silent, refused...),
  retries from 5 s doubling up to 5 minutes, and a "Test the connection" button.

### Changed (review before the first release)

- The status names the fix only as "position fixed" and changes at most once
  every 10 seconds while connected (a fix that came and went sent one status
  per report); the test button still tells 2D, 3D, DGPS...
- The values of the TPV reports of one fix are merged: a value missing from the
  newest report (gpsd 3.25 sends the course and speed in one report out of two)
  is taken from one at most 3 s old, never across a loss of fix.
- The first receiver that reports is released when gpsd deactivates it.
- Altitude and course keep no history by default either.
- Docs: what stays shown without a fix, which features keep a history, when
  the status lists other receivers, the `gpsd.socket` drop-in.
- CI: `timeout-minutes` on every workflow job.

[Unreleased]: https://github.com/LM1LC3N7/gladys-gpsd/commits/main
