# Third-party notices

No third-party code is copied into this integration, and nothing but the
Gladys SDK is installed at runtime.

## gpsd

gpsd (<https://gitlab.com/gpsd/gpsd>, the GPSD project, BSD-2-Clause per its
`COPYING`, latest release 3.28 when this integration was written) runs on the
user's machine and is only talked to: this integration speaks the protocol
described by the official document "gpsd JSON protocol"
(<https://gpsd.gitlab.io/gpsd/gpsd_json.html>): the `VERSION` banner, the
`?WATCH={"enable":true,"json":true};` and `?VERSION;` requests, and the `TPV`,
`SKY`, `DEVICES`, `DEVICE` and `ERROR` objects. No line of gpsd's code (nor
of its client libraries) is used, copied or adapted. The tests replay an NMEA
log through gpsd and `gpsfake` (the Debian packages `gpsd` and `gpsd-clients`)
in a throwaway container, outside the repository and the image. This
integration is unofficial and not affiliated with the GPSD project.

## gladys-testkit

`test/kit/` is copied from `gladys-testkit` (Apache-2.0, same author): fake
TCP servers and clocks, used by the tests only, never in the image.
