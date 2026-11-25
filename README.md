# gladys-gpsd

[Gladys Assistant](https://gladysassistant.com) external integration for
**gpsd**: the GPS / GNSS receiver that gpsd shares on the local network (camper
van, boat, cabin) becomes one Gladys device: latitude, longitude, speed,
altitude, course, fix mode, fix, horizontal error, satellites used and seen.
Read only, TCP only (gpsd JSON protocol, port 2947 by default).
**Unofficial integration, not affiliated with the GPSD project. Never tested
with a real receiver yet (tested with gpsd 3.25 and `gpsfake`).**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (GpsdApp)        pace, freshness, status, retries
                 ├─ src/gpsd/session.js     one TCP connection: banner, ?WATCH, probe, bounds
                 ├─ src/gpsd/parse.js       gpsd JSON objects -> plain values (ranges, unknowns)
                 ├─ src/report.js           reports -> states (rounding, units)
                 ├─ src/devices.js          the device (pure), never fewer features
                 └─ src/config.js           address, receiver, choices
```

- **Protocol** (from the official "gpsd JSON protocol" document): the
  `VERSION` banner (protocol 3) within 5 s, then
  `?WATCH={"enable":true,"json":true};` (never NMEA nor raw), then `TPV`, `SKY`,
  `DEVICES` / `DEVICE` and `ERROR` objects. A connection silent for 60 s is
  asked `?VERSION;` and closed without an answer within 10 s.
- **Bounds**: lines of 16 KiB at most (a longer one is dropped up to its
  newline), 256 KiB/s at most (more closes the connection), 256 satellites
  read per SKY, values out of physical range unknown (never 0).
- **Pace**: the newest TPV and SKY are kept (a TPV value missing from the
  newest report is taken from one of the same fix at most 3 s old, its age
  kept); a round
  publishes them at most once per interval (10 s to 15 min, 1 min by default,
  across reconnections too), the first one at once, only what changed (`publishChangedStates`, heartbeat
  1 h). A round without a new report publishes nothing; the reports kept are
  dropped when the connection ends or the receiver goes away. At most 10 states
  per round: 60 states/min at the fastest.
- **Privacy**: latitude, longitude (and altitude) rounded to the chosen
  precision before publication; no coordinate in the logs, the status or the
  test button; no position history by default; nothing in `/data`.
- **Statuses**: at most one per 10 s while connected (the kind of fix is not
  in the status, only in the test button); failures at once.
- **Retries**: 5 s doubling up to 5 min, back to 5 s after a connection that
  lived a minute. `getConfig()` failing: retried from 10 s doubling to 5 min.
  Every timer finite, one per flow, all cleared by `stop()`; the wall clock
  decides nothing (monotonic only).
- **Identity**: `receiver:<12 hex digits of sha256(host:port)>`.

## Development

```bash
npm install
npm test                                        # node --test, loopback only
npm run lint && npm run format:check
npm run audit                                   # production dependencies
npm run cover                                   # regenerate cover.png
node scripts/mutants.mjs                        # mutation check of the guards (scripts/mutants.json)
npx github:GladysAssistant/integration-store .  # store admission checks
```

The tests run against the SDK's fake Gladys, a scripted gpsd socket on a
virtual clock (`test/helpers/`), local TCP fake gpsd servers and a real sped-up
clock (`test/kit/`, from gladys-testkit). No test touches the Internet.

To try with a real gpsd without installing anything (Debian packages in a
throwaway container, an NMEA log replayed by `gpsfake`):

```bash
docker run --rm -d --name gpsd-try -p 127.0.0.1:2947:2947 -v "$PWD/my.nmea:/log.nmea:ro" \
  debian:trixie-slim sh -c 'apt-get update -qq && apt-get install -y -qq gpsd gpsd-clients >/dev/null && \
  gpsfake -c 0.166 -n -P 2947 --options="-G" /log.nmea'
# then point the integration (or gpspipe -w 127.0.0.1) at 127.0.0.1:2947
docker rm -f gpsd-try
```

## Credits

- [gpsd](https://gpsd.io) (BSD-2-Clause): only its protocol is spoken, from its
  official documentation; no code of gpsd is used (see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
